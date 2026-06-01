/**
 * Outlight Gmail → ticket webhook forwarder — GMAIL API (ADVANCED SERVICE) VERSION.
 *
 * WHY THIS VERSION: the simple `GmailApp` service has a low per-account daily cap
 * ("Service invoked too many times for one day: premium gmail"). The Gmail API
 * advanced service uses a SEPARATE, much larger quota bucket, so it keeps working
 * even after GmailApp is exhausted for the day. Paste THIS over Code.gs.
 *
 * ── One-time setup in the editor ──────────────────────────────────────────────
 * 1. Left sidebar → Services (the "+" next to Services) → add "Gmail API"
 *    (identifier must be `Gmail`). This is required or every Gmail.* call throws.
 * 2. Project Settings → Script properties:
 *      EMAIL_WEBHOOK_SECRET = (already set — leave it)
 *      BACKFILL_DAYS        = 7        (recover recent backlog; lower = lighter)
 * 3. Run processSupportEmails once → re-authorize when prompted (it now needs the
 *    Gmail API scope, so Google will ask again — Advanced → Go to project → Allow).
 * 4. Triggers (clock icon): DELETE the old `processNewEmails` trigger, then
 *    Add Trigger → function processSupportEmails, Time-driven, every 10 minutes.
 *
 * The backend dedupes by RFC Message-ID, so re-running never double-creates tickets.
 */

var WEBHOOK_URL = 'https://shopify-ai-chatbot-production-9ab4.up.railway.app/api/webhooks/email';

// Single brand. (Warm runs its own script in its own account.)
var BRANDS = [
  { slug: 'outlight', supportEmail: 'support@outlight.us' },
];

var PROCESSED_LABEL = 'AI-Tickets/Processed';
var FAILED_LABEL = 'AI-Tickets/Failed';
var MAX_THREADS_PER_BRAND = 10;   // threads forwarded per run; trigger drains the rest
var MAX_THREAD_HISTORY = 12;      // cap prior messages forwarded as history (newest kept)

function processSupportEmails() {
  var props = PropertiesService.getScriptProperties();
  var webhookSecret = props.getProperty('EMAIL_WEBHOOK_SECRET') || '';
  var backfillDays = parseInt(props.getProperty('BACKFILL_DAYS') || '7', 10);
  if (!(backfillDays > 0)) backfillDays = 7;

  var totals = { forwarded: 0, skipped: 0, failed: 0 };
  var stop = false;

  var processedId, failedId;
  try {
    processedId = getOrCreateLabelId(PROCESSED_LABEL);
    failedId = getOrCreateLabelId(FAILED_LABEL);
  } catch (err) {
    console.error('Could not resolve labels via Gmail API (is the "Gmail API" advanced service added?): ' + err);
    return;
  }

  for (var b = 0; b < BRANDS.length && !stop; b++) {
    var brand = BRANDS[b];
    var query = 'to:' + brand.supportEmail + ' newer_than:' + backfillDays + 'd -label:' + PROCESSED_LABEL;

    var threadStubs;
    try {
      var listResp = Gmail.Users.Threads.list('me', { q: query, maxResults: MAX_THREADS_PER_BRAND });
      threadStubs = (listResp && listResp.threads) || [];
    } catch (err) {
      console.error('[' + brand.slug + '] thread list failed: ' + err);
      continue;
    }

    for (var t = 0; t < threadStubs.length && !stop; t++) {
      var threadId = threadStubs[t].id;
      try {
        var thread = Gmail.Users.Threads.get('me', threadId, { format: 'full' });
        var messages = (thread.messages || []).map(fullMessage);
        var latest = messages[messages.length - 1];

        if (!latest || isFromSupport(latest, brand.supportEmail) || isAutomatedMessage(latest)) {
          Gmail.Users.Threads.modify({ addLabelIds: [processedId] }, 'me', threadId);
          totals.skipped++;
          continue;
        }

        var latestFrom = getHeader(latest.payload, 'From');
        var recentMessages = messages.length > MAX_THREAD_HISTORY
          ? messages.slice(messages.length - MAX_THREAD_HISTORY)
          : messages;

        var payload = {
          from_email: extractEmail(latestFrom),
          from_name: extractName(latestFrom),
          to_email: brand.supportEmail,
          recipient: brand.supportEmail,
          subject: getHeader(latest.payload, 'Subject') || '(No Subject)',
          text: getPlainBody(latest) || '',
          html: getHtmlBody(latest) || '',
          message_id: getHeader(latest.payload, 'Message-ID') || latest.id,
          in_reply_to: getHeader(latest.payload, 'In-Reply-To') || '',
          references: getHeader(latest.payload, 'References') || '',
          thread_messages: recentMessages.map(function (message) {
            var from = getHeader(message.payload, 'From');
            var plain = getPlainBody(message) || '';
            return {
              from_email: extractEmail(from),
              from_name: extractName(from),
              text: plain,
              body: plain,
              message_id: getHeader(message.payload, 'Message-ID') || message.id,
              date: new Date(parseInt(message.internalDate, 10)).toISOString(),
            };
          }),
        };

        // Don't fire doomed 400s; log what we parsed so empties are visible in the log.
        if (!payload.from_email || (!payload.text && !payload.html)) {
          console.warn('[outlight] skip empty-after-parse from="' + payload.from_email
            + '" textLen=' + payload.text.length + ' htmlLen=' + payload.html.length
            + ' hasPayload=' + (!!latest.payload) + ' snippet="' + String(latest.snippet || '').slice(0, 60) + '"');
          Gmail.Users.Threads.modify({ addLabelIds: [failedId] }, 'me', threadId);
          totals.failed++;
          continue;
        }
        console.log('[outlight] forwarding from=' + payload.from_email
          + ' textLen=' + payload.text.length + ' htmlLen=' + payload.html.length);

        var headers = { 'X-Brand': brand.slug };
        if (webhookSecret) headers.Authorization = 'Bearer ' + webhookSecret;

        var response = UrlFetchApp.fetch(WEBHOOK_URL + '?brand=' + encodeURIComponent(brand.slug), {
          method: 'post',
          contentType: 'application/json',
          muteHttpExceptions: true,
          headers: headers,
          payload: JSON.stringify(payload),
        });

        var status = response.getResponseCode();
        if (status === 401 || status === 403) {
          // Account-wide auth failure (wrong/missing EMAIL_WEBHOOK_SECRET) — every
          // thread fails the same way. Stop cleanly; this thread stays unlabeled to retry.
          console.error('Webhook auth failed (' + status + '). Make EMAIL_WEBHOOK_SECRET match the backend, then re-run. Stopping run.');
          stop = true;
          continue;
        }
        if (status < 200 || status >= 300) {
          throw new Error('Webhook returned ' + status + ': ' + response.getContentText());
        }

        Gmail.Users.Threads.modify({ addLabelIds: [processedId], removeLabelIds: [failedId] }, 'me', threadId);
        totals.forwarded++;
      } catch (err) {
        console.error('[' + brand.slug + '] ' + err);
        try { Gmail.Users.Threads.modify({ addLabelIds: [failedId] }, 'me', threadId); } catch (e2) {}
        totals.failed++;
      }
    }
  }

  console.log('Outlight support email sync (Gmail API) complete: ' + JSON.stringify(totals));
}

/**
 * One-time helper: label every matching thread Processed WITHOUT forwarding, to
 * set a clean baseline. NOT needed for recovery (there you WANT the backlog).
 */
function markAllExistingAsProcessed() {
  var processedId = getOrCreateLabelId(PROCESSED_LABEL);
  var count = 0;
  for (var b = 0; b < BRANDS.length; b++) {
    var resp = Gmail.Users.Threads.list('me', { q: 'to:' + BRANDS[b].supportEmail + ' -label:' + PROCESSED_LABEL, maxResults: 100 });
    var stubs = (resp && resp.threads) || [];
    for (var t = 0; t < stubs.length; t++) {
      Gmail.Users.Threads.modify({ addLabelIds: [processedId] }, 'me', stubs[t].id);
      count++;
    }
  }
  console.log('Marked ' + count + ' threads as processed (no forwarding).');
}

/**
 * One-time backlog refresh: strip the Processed label from every thread so they
 * re-import on the next run. Use AFTER deleting the existing email tickets in the
 * admin, to re-pull the backlog with full bodies. Order:
 *   1) Admin → Delete Emails   2) run unprocessAll()   3) run processSupportEmails
 */
function unprocessAll() {
  var resp = Gmail.Users.Labels.list('me');
  var labels = (resp && resp.labels) || [];
  var pid = null;
  for (var i = 0; i < labels.length; i++) if (labels[i].name === PROCESSED_LABEL) pid = labels[i].id;
  if (!pid) { console.log('no Processed label found — nothing to do'); return; }
  var count = 0;
  for (var b = 0; b < BRANDS.length; b++) {
    var pageToken = null;
    do {
      var r = Gmail.Users.Threads.list('me', {
        q: 'to:' + BRANDS[b].supportEmail + ' label:' + PROCESSED_LABEL,
        maxResults: 100, pageToken: pageToken,
      });
      var stubs = (r && r.threads) || [];
      for (var t = 0; t < stubs.length; t++) {
        Gmail.Users.Threads.modify({ removeLabelIds: [pid] }, 'me', stubs[t].id);
        count++;
      }
      pageToken = r && r.nextPageToken;
    } while (pageToken);
  }
  console.log('Un-processed ' + count + ' threads — run processSupportEmails to re-import with full bodies.');
}

// ── Gmail API helpers ────────────────────────────────────────────────────────

var _labelCache = {};
function getOrCreateLabelId(name) {
  if (_labelCache[name]) return _labelCache[name];
  var resp = Gmail.Users.Labels.list('me');
  var labels = (resp && resp.labels) || [];
  for (var i = 0; i < labels.length; i++) {
    if (labels[i].name === name) { _labelCache[name] = labels[i].id; return labels[i].id; }
  }
  var created = Gmail.Users.Labels.create(
    { name: name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    'me'
  );
  _labelCache[name] = created.id;
  return created.id;
}

// Threads.get returns headers but strips the body data, so ALWAYS pull each
// message individually — Messages.get(full) includes the inline text/plain and
// text/html parts that the thread response leaves out.
function fullMessage(m) {
  if (!m || !m.id) return m;
  try { return Gmail.Users.Messages.get('me', m.id, { format: 'full' }); } catch (e) { return m; }
}

function getHeader(payload, name) {
  var headers = (payload && payload.headers) || [];
  var target = String(name).toLowerCase();
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i].name).toLowerCase() === target) return headers[i].value || '';
  }
  return '';
}

function decodeBody(data) {
  if (!data) return '';
  try {
    // The Apps Script advanced Gmail service hands back body.data ALREADY
    // base64-decoded, as a Byte[]. Just wrap the bytes and read them as text —
    // no base64 step (decoding it again is what kept failing → snippet fallback).
    if (typeof data !== 'string') {
      return Utilities.newBlob(data).getDataAsString('UTF-8');
    }
    // Defensive: if a string ever arrives, treat it as URL-safe base64.
    var b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    return Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString('UTF-8');
  } catch (e) {
    return '';
  }
}

// Depth-first search the MIME tree for the first part of mimeType that has body data.
function findPart(part, mimeType) {
  if (!part) return '';
  if (part.mimeType === mimeType && part.body && part.body.data) return decodeBody(part.body.data);
  var parts = part.parts || [];
  for (var i = 0; i < parts.length; i++) {
    var found = findPart(parts[i], mimeType);
    if (found) return found;
  }
  return '';
}

function getPlainBody(message) {
  var text = findPart(message.payload, 'text/plain');
  if (text) return text;
  var html = findPart(message.payload, 'text/html');
  if (html) return html.replace(/<[^>]+>/g, ' ');
  return String(message.snippet || '');   // last resort so a real email is never empty
}

function getHtmlBody(message) {
  return findPart(message.payload, 'text/html') || '';
}

// ── Shared parsing / filtering (provider-agnostic) ───────────────────────────

function extractEmail(value) {
  var match = String(value || '').match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

function extractName(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/"/g, '').trim();
}

function isFromSupport(message, supportEmail) {
  return extractEmail(getHeader(message.payload, 'From')) === String(supportEmail).toLowerCase();
}

function isAutomatedMessage(message) {
  var from = extractEmail(getHeader(message.payload, 'From'));
  var subject = String(getHeader(message.payload, 'Subject') || '').toLowerCase();
  return [
    'security@',
    'account-security',
    'no-reply@',
    'noreply@',
    'notification@',
    'notifications@',
    'mailer-daemon@',
    'postmaster@',
  ].some(function (part) { return from.indexOf(part) !== -1; })
    || [
      '@mail.instagram.com',
      '@facebookmail.com',
      '@accounts.google.com',
      '@google.com',
      '@shopify.com',
    ].some(function (domain) { return from.lastIndexOf(domain) === from.length - domain.length; })
    || [
      'two-factor authentication',
      'new login',
      'security alert',
      'verification code',
      'password reset',
      'delivery status notification',
      'undeliverable',
    ].some(function (part) { return subject.indexOf(part) !== -1; });
}

// ── Optional diagnostic: run manually to verify body extraction (read-only) ──
function debugBody() {
  var brand = BRANDS[0];
  var resp = Gmail.Users.Threads.list('me', { q: 'to:' + brand.supportEmail + ' newer_than:30d', maxResults: 10 });
  var stubs = (resp && resp.threads) || [];
  console.log('threads found: ' + stubs.length);
  var shown = 0;
  for (var i = 0; i < stubs.length && shown < 2; i++) {
    var thr = Gmail.Users.Threads.get('me', stubs[i].id, { format: 'full' });
    var msgs = thr.messages || [];
    var last = msgs[msgs.length - 1];
    if (isFromSupport(last, brand.supportEmail) || isAutomatedMessage(last)) continue;
    var full = Gmail.Users.Messages.get('me', last.id, { format: 'full' });
    console.log('===== from: ' + getHeader(full.payload, 'From') + ' =====');
    console.log('getPlainBody() len = ' + getPlainBody(full).length + ' | snippet len = ' + String(full.snippet || '').length);
    shown++;
  }
  if (shown === 0) console.log('no customer messages found in window');
}
