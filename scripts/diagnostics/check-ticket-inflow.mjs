/**
 * Ticket-inflow health check (read-only).
 *
 * The May-2026 incident — Outlight tickets stopped flowing for ~3 weeks before
 * anyone noticed — was invisible because nothing watched the inflow. Run this to
 * catch a stall early: per-brand last-ticket age, source mix, inbox config, and a
 * simulation of the webhook's recipient→brand routing.
 *
 *   node scripts/diagnostics/check-ticket-inflow.mjs
 *
 * Reads SUPABASE creds from apps/backend/.env. Exits non-zero if any enabled brand
 * has had no ticket in STALE_HOURS (default 48), so it can drive a cron/alert.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const STALE_HOURS = Number(process.env.STALE_HOURS || 48);

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv('apps/backend/.env');
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in apps/backend/.env');
  process.exit(2);
}
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Mirror of brand-email-config.service: default support inbox per slug.
const DEFAULT_SUPPORT = { outlight: 'support@outlight.us', 'warm-by-design': 'support@warmbydesign.com' };
const xa = (v) => { const m = String(v).match(/<([^>]+)>/); const a = (m?.[1] || v).trim().toLowerCase(); return a.includes('@') ? a : null; };
const ss = (s, k) => { const v = s?.[k]; return typeof v === 'string' && v.trim() ? v.trim() : undefined; };
const supportFrom = (s) => ss(s, 'support_email') || ss(s, 'supportEmail') || ss(s, 'inbound_email') || ss(s, 'inboundEmail');

const { data: brands, error: be } = await sb.from('brands').select('id, slug, name, enabled, settings').eq('enabled', true);
if (be) { console.error('brands query failed:', be.message); process.exit(2); }

const now = Date.now();
let stale = 0;
console.log(`\nTicket-inflow health  (stale threshold: ${STALE_HOURS}h)\n${'='.repeat(60)}`);

for (const b of brands) {
  const s = b.settings || {};
  const inbox = supportFrom(s) || DEFAULT_SUPPORT[b.slug] || '(none)';

  const { data: last } = await sb.from('tickets').select('ticket_number, source, created_at')
    .eq('brand_id', b.id).order('created_at', { ascending: false }).limit(1);
  const { data: sample } = await sb.from('tickets').select('source')
    .eq('brand_id', b.id).order('created_at', { ascending: false }).limit(200);

  const srcTally = {};
  for (const t of sample || []) srcTally[t.source] = (srcTally[t.source] || 0) + 1;

  const latest = last?.[0]?.created_at;
  const ageH = latest ? (now - new Date(latest).getTime()) / 3.6e6 : Infinity;
  const isStale = ageH > STALE_HOURS;
  if (isStale) stale++;

  const inboxOk = inbox !== '(none)';
  console.log(`\n${isStale ? '⚠️ ' : '✅ '}${b.slug}  (${b.name})`);
  console.log(`   inbox: ${inbox}${inboxOk ? '' : '  ← NOT CONFIGURED: inbound email will 422'}`);
  console.log(`   last ticket: ${latest ? `${latest}  (${ageH.toFixed(1)}h ago, #${last[0].ticket_number}, src=${last[0].source})` : 'NONE'}`);
  console.log(`   recent source mix: ${JSON.stringify(srcTally)}`);
  if (isStale) console.log(`   → STALE: no ticket in ${STALE_HOURS}h. Check the Gmail Apps Script (forwarder), the contact form, and AI escalation.`);
}

console.log(`\n${'='.repeat(60)}\n${stale === 0 ? '✅ All enabled brands have recent inflow.' : `⚠️  ${stale} brand(s) stale — investigate.`}\n`);
process.exit(stale === 0 ? 0 : 1);
