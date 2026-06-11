#!/usr/bin/env node
/**
 * Restore supportOS agent replies into the brand Gmail inboxes.
 *
 * WHY: Agent replies are sent to customers via Resend, so the Gmail mailbox
 * (support@outlight.us / support@warmbydesign.com) never sees them — the
 * correspondence exists only inside supportOS. This script sends an archive
 * copy of every past agent reply TO the brand's own support inbox, with
 * In-Reply-To/References headers so Gmail threads it into the original
 * conversation. Customers receive nothing.
 *
 * Idempotent: each restored message is marked metadata.gmail_archive_at and
 * skipped on re-runs. Safe to stop and re-run any time.
 *
 * Loop-safe: the Gmail forwarder and the backend inbound webhook both drop
 * messages whose sender is the support address itself.
 *
 * Usage:
 *   node scripts/restore-sent-replies-to-gmail.mjs --dry-run
 *   node scripts/restore-sent-replies-to-gmail.mjs            # full run
 *   node scripts/restore-sent-replies-to-gmail.mjs --limit=20 # first 20 only
 *   node scripts/restore-sent-replies-to-gmail.mjs --since=2026-03-01
 */

import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ── env loading (root .env + apps/admin/.env.local for Resend keys) ─────────
function parseEnvFile(file) {
  const out = {};
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2].replace(/\\n/g, '').trim();
  }
  return out;
}

const env = {
  ...parseEnvFile(path.join(ROOT, '.env')),
  ...parseEnvFile(path.join(ROOT, 'apps/admin/.env.local')),
  ...process.env,
};

const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || 0) || Infinity;
const SINCE = (process.argv.find((a) => a.startsWith('--since=')) || '').split('=')[1] || null;

// ── tiny REST helpers ────────────────────────────────────────────────────────
async function sb(pathname, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${pathname}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${pathname} → ${res.status}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeEnvSuffix(slug) {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

function resendKeyForBrand(slug) {
  return (
    env[`RESEND_API_KEY_${normalizeEnvSuffix(slug)}`] ||
    env[`RESEND_API_KEY_${slug.toUpperCase()}`] ||
    env.RESEND_API_KEY ||
    ''
  );
}

async function sendResend(apiKey, payload, attempt = 0) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': 'supportos-gmail-restore/1.0',
    },
    body: JSON.stringify(payload),
  });
  if (res.status === 429 && attempt < 5) {
    const wait = Math.min(30000, 2000 * 2 ** attempt);
    console.log(`  rate-limited, waiting ${wait}ms…`);
    await sleep(wait);
    return sendResend(apiKey, payload, attempt + 1);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Gmail restore — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${SINCE ? ` since ${SINCE}` : ''}`);

  // Brands
  const brands = await sb('/brands?select=id,slug,name,settings');
  const brandById = new Map();
  for (const b of brands) {
    const s = b.settings || {};
    const supportEmail = s.support_email || s.supportEmail || s.inbound_email || s.inboundEmail || null;
    const fromAddress =
      s.support_from_address || s.email_from_address ||
      env[`EMAIL_FROM_ADDRESS_${normalizeEnvSuffix(b.slug)}`] ||
      (supportEmail ? `${b.name} <${supportEmail}>` : null);
    brandById.set(b.id, { slug: b.slug, name: b.name, supportEmail, fromAddress });
  }

  // All agent replies (paginated)
  const replies = [];
  for (let offset = 0; ; offset += 1000) {
    const since = SINCE ? `&created_at=gte.${SINCE}` : '';
    const page = await sb(
      `/ticket_messages?sender_type=eq.agent&is_internal_note=eq.false${since}` +
      `&select=id,ticket_id,content,created_at,sender_name,email_message_id,metadata` +
      `&order=created_at.asc&offset=${offset}&limit=1000`
    );
    replies.push(...page);
    if (page.length < 1000) break;
  }
  console.log(`agent replies found: ${replies.length}`);

  const pending = replies.filter((r) => !(r.metadata && r.metadata.gmail_archive_at));
  console.log(`not yet restored:   ${pending.length}`);

  // Tickets for those replies
  const ticketIds = [...new Set(pending.map((r) => r.ticket_id))];
  const tickets = new Map();
  for (let i = 0; i < ticketIds.length; i += 80) {
    const chunk = ticketIds.slice(i, i + 80);
    const rows = await sb(
      `/tickets?id=in.(${chunk.join(',')})&select=id,ticket_number,subject,customer_email,customer_name,brand_id`
    );
    for (const t of rows) tickets.set(t.id, t);
  }

  // Threading anchors: latest customer message-id per ticket
  const anchors = new Map();
  for (let i = 0; i < ticketIds.length; i += 80) {
    const chunk = ticketIds.slice(i, i + 80);
    const rows = await sb(
      `/ticket_messages?ticket_id=in.(${chunk.join(',')})&sender_type=eq.customer` +
      `&email_message_id=not.is.null&select=ticket_id,email_message_id,created_at&order=created_at.asc`
    );
    for (const m of rows) anchors.set(m.ticket_id, m.email_message_id); // last write wins = latest
  }

  const stats = { sent: 0, skippedNoTicket: 0, skippedNoBrandInbox: 0, failed: 0 };
  let processed = 0;

  for (const reply of pending) {
    if (processed >= LIMIT) break;

    const ticket = tickets.get(reply.ticket_id);
    if (!ticket) { stats.skippedNoTicket++; continue; }
    const brand = brandById.get(ticket.brand_id);
    if (!brand || !brand.supportEmail || !brand.fromAddress) { stats.skippedNoBrandInbox++; continue; }
    const apiKey = resendKeyForBrand(brand.slug);
    if (!apiKey) { stats.skippedNoBrandInbox++; continue; }

    processed++;

    const sentDate = new Date(reply.created_at).toUTCString();
    const wasEmailed = !!reply.email_message_id;
    const agent = reply.sender_name || 'Agent';
    const customer = ticket.customer_name
      ? `${ticket.customer_name} <${ticket.customer_email || 'no email'}>`
      : (ticket.customer_email || 'unknown customer');
    const statusLine = wasEmailed
      ? `Delivered to the customer via email on ${sentDate}.`
      : `Saved in supportOS on ${sentDate} — this reply was NOT emailed to the customer at the time.`;

    const subject = `Re: [Ticket #${ticket.ticket_number}] ${ticket.subject}`;
    const banner =
      `[supportOS archive] Reply by ${agent} on Ticket #${ticket.ticket_number} to ${customer}.\n` +
      `${statusLine}\n` +
      `Restored to Gmail for record-keeping — no email was sent to the customer by this restore.\n` +
      `----------------------------------------------------------------------`;

    const text = `${banner}\n\n${reply.content}`;
    const html =
      `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;color:#1a1a1a;">` +
      `<div style="background:#f6f6f4;border:1px solid #e3e3df;border-radius:8px;padding:10px 14px;color:#666;font-size:12px;white-space:pre-wrap;">${escapeHtml(banner.replace(/-{10,}/, '').trim())}</div>` +
      `<div style="white-space:pre-wrap;line-height:1.6;margin-top:16px;">${escapeHtml(reply.content)}</div>` +
      `</div>`;

    const anchor = anchors.get(reply.ticket_id);
    const headers = { 'X-SupportOS-Archive': '1', 'X-Ticket-Number': String(ticket.ticket_number) };
    if (anchor) { headers['In-Reply-To'] = anchor; headers['References'] = anchor; }

    if (DRY_RUN) {
      stats.sent++;
      if (stats.sent <= 10) {
        console.log(`[dry] ${brand.slug} #${ticket.ticket_number} ${reply.created_at.slice(0, 10)} ${wasEmailed ? '(was delivered)' : '(NEVER emailed)'} → ${brand.supportEmail}${anchor ? ' [threaded]' : ' [new thread]'}`);
      }
      continue;
    }

    try {
      const result = await sendResend(apiKey, {
        from: brand.fromAddress,
        to: [brand.supportEmail],
        subject,
        text,
        html,
        headers,
      });

      const newMeta = { ...(reply.metadata || {}), gmail_archive_at: new Date().toISOString(), gmail_archive_id: result.id || null };
      await sb(`/ticket_messages?id=eq.${reply.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ metadata: newMeta }),
      });

      stats.sent++;
      if (stats.sent % 25 === 0) console.log(`  …${stats.sent} restored`);
      await sleep(650); // stay under Resend rate limits
    } catch (err) {
      stats.failed++;
      console.error(`  FAILED ${brand.slug} #${ticket.ticket_number} (${reply.id}): ${err.message}`);
      if (stats.failed >= 15) {
        console.error('Too many failures — stopping. Re-run to resume (idempotent).');
        break;
      }
      await sleep(1500);
    }
  }

  console.log('\n── summary ──');
  console.log(`restored:               ${stats.sent}${DRY_RUN ? ' (dry run, nothing sent)' : ''}`);
  console.log(`failed:                 ${stats.failed}`);
  console.log(`skipped (no ticket):    ${stats.skippedNoTicket}`);
  console.log(`skipped (no inbox/key): ${stats.skippedNoBrandInbox}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
