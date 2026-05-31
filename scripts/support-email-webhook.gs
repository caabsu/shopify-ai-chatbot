/**
 * Multi-brand Gmail → ticket webhook forwarder.
 *
 * Replaces the single-brand `warm-support-email-webhook.gs`. Polls every brand's
 * support inbox in one pass and forwards new customer emails to the backend
 * webhook, routed by `?brand=<slug>`. The backend deduplicates by RFC
 * Message-ID, so re-running over already-forwarded mail is safe (no duplicate
 * tickets) — which makes the BACKFILL_DAYS catch-up below safe to use.
 *
 * ── Deploy ───────────────────────────────────────────────────────────────────
 * 1. Open the existing Apps Script project that already forwards Warm email
 *    (script.google.com → your "Warm support" project). It already holds the
 *    EMAIL_WEBHOOK_SECRET script property and an authorized time-driven trigger.
 * 2. Replace the entire file contents with this file.
 * 3. (Optional, one-time backfill) Project Settings → Script properties →
 *    set `BACKFILL_DAYS` = 21 to recover the Outlight backlog since it stopped
 *    on 2026-05-11. Run `processSupportEmails` once manually, then set it back
 *    to 7 (or delete the property).
 * 4. Confirm the trigger still calls `processSupportEmails` (rename from the old
 *    `processWarmSupportEmails` if needed): Triggers → edit → function =
 *    processSupportEmails, event = Time-driven, every 5–10 minutes.
 *
 * Assumes all listed support addresses deliver into THIS Google account (as
 * aliases/forwards). If a brand uses a separate Google account, deploy a copy
 * of this script there with only that brand in BRANDS.
 */

var WEBHOOK_URL = 'https://shopify-ai-chatbot-production-9ab4.up.railway.app/api/webhooks/email';

// Add a brand here and it starts flowing — no backend change needed.
var BRANDS = [
  { slug: 'outlight',        supportEmail: 'support@outlight.us' },
  { slug: 'warm-by-design',  supportEmail: 'support@warmbydesign.com' },
];

var PROCESSED_LABEL = 'AI-Tickets/Processed';
var FAILED_LABEL = 'AI-Tickets/Failed';
// Keep this small: each thread costs many Gmail API calls, and consumer/Workspace
// accounts have a daily Gmail quota ("Service invoked too many times"). 10/run with
// a 5–10 min trigger clears a backlog over a few hours without exhausting quota.
var MAX_THREADS_PER_BRAND = 10;
// Cap how many prior messages of a thread we forward as history (newest kept).
var MAX_THREAD_HISTORY = 12;

function processSupportEmails() {
  var props = PropertiesService.getScriptProperties();
  var webhookSecret = props.getProperty('EMAIL_WEBHOOK_SECRET') || '';
  var backfillDays = parseInt(props.getProperty('BACKFILL_DAYS') || '7', 10);
  if (!(backfillDays > 0)) backfillDays = 7;

  var totals = { forwarded: 0, skipped: 0, failed: 0 };
  var quotaHit = false;

  // Label creation can itself hit the daily Gmail quota — fail soft, not red.
  var processedLabel, failedLabel;
  try {
    processedLabel = getOrCreateLabel(PROCESSED_LABEL);
    failedLabel = getOrCreateLabel(FAILED_LABEL);
  } catch (err) {
    console.warn('Gmail daily quota reached before processing — nothing done, retry next trigger. ' + err);
    return;
  }

  for (var b = 0; b < BRANDS.length && !quotaHit; b++) {
    var brand = BRANDS[b];
    var query = 'to:' + brand.supportEmail + ' newer_than:' + backfillDays + 'd -label:' + PROCESSED_LABEL;
    var threads;
    try {
      threads = GmailApp.search(query, 0, MAX_THREADS_PER_BRAND);
    } catch (err) {
      if (isQuotaError(err)) { console.warn('Gmail quota reached during search — stopping; retry next trigger.'); break; }
      console.error('[' + brand.slug + '] search failed: ' + err);
      continue;
    }

    for (var t = 0; t < threads.length && !quotaHit; t++) {
      var thread = threads[t];
      try {
        var messages = thread.getMessages();
        var latest = messages[messages.length - 1];
        if (!latest || isFromSupport(latest, brand.supportEmail) || isAutomatedMessage(latest)) {
          thread.addLabel(processedLabel);
          totals.skipped++;
          continue;
        }

        // Cache getFrom()/getPlainBody() — each is a Gmail API call. Cap history.
        var latestFrom = latest.getFrom();
        var recentMessages = messages.length > MAX_THREAD_HISTORY
          ? messages.slice(messages.length - MAX_THREAD_HISTORY)
          : messages;
        var payload = {
          from_email: extractEmail(latestFrom),
          from_name: extractName(latestFrom),
          to_email: brand.supportEmail,
          recipient: brand.supportEmail,
          subject: latest.getSubject() || '(No Subject)',
          text: latest.getPlainBody() || '',
          html: latest.getBody() || '',
          message_id: latest.getHeader('Message-ID') || latest.getId(),
          in_reply_to: latest.getHeader('In-Reply-To') || '',
          references: latest.getHeader('References') || '',
          thread_messages: recentMessages.map(function (message) {
            var from = message.getFrom();
            var plain = message.getPlainBody() || '';
            return {
              from_email: extractEmail(from),
              from_name: extractName(from),
              text: plain,
              body: plain,
              message_id: message.getHeader('Message-ID') || message.getId(),
              date: message.getDate().toISOString(),
            };
          }),
        };

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
        if (status < 200 || status >= 300) {
          throw new Error('Webhook returned ' + status + ' for ' + brand.slug + ': ' + response.getContentText());
        }

        thread.addLabel(processedLabel);
        thread.removeLabel(failedLabel);
        totals.forwarded++;
      } catch (err) {
        if (isQuotaError(err)) {
          quotaHit = true;
          console.warn('Gmail daily quota reached — stopping; this + remaining threads retry next trigger. ' + err);
        } else {
          console.error('[' + brand.slug + '] ' + err);
          thread.addLabel(failedLabel);
          totals.failed++;
        }
      }
    }
  }

  console.log('Support email sync complete: ' + JSON.stringify(totals));
}

/**
 * One-time helper: label every matching thread as Processed WITHOUT forwarding,
 * to establish a clean baseline before enabling the trigger (avoids backfilling
 * old mail). Not needed for the Outlight recovery — there you WANT to forward the
 * backlog, so run processSupportEmails instead.
 */
function markAllExistingAsProcessed() {
  var processedLabel = getOrCreateLabel(PROCESSED_LABEL);
  var count = 0;
  for (var b = 0; b < BRANDS.length; b++) {
    var threads = GmailApp.search('to:' + BRANDS[b].supportEmail + ' -label:' + PROCESSED_LABEL, 0, 100);
    for (var t = 0; t < threads.length; t++) { threads[t].addLabel(processedLabel); count++; }
  }
  console.log('Marked ' + count + ' threads as processed (no forwarding).');
}

// True for Gmail daily-quota / rate-limit exceptions, so a run can stop cleanly
// (leaving unprocessed threads unlabeled to retry next trigger) instead of
// mislabeling good threads as Failed.
function isQuotaError(err) {
  var m = String(err).toLowerCase();
  return m.indexOf('too many times') !== -1
    || m.indexOf('limit exceeded') !== -1
    || m.indexOf('rate limit') !== -1
    || m.indexOf('quota') !== -1;
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function extractEmail(value) {
  var match = String(value || '').match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

function extractName(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/"/g, '').trim();
}

function isFromSupport(message, supportEmail) {
  return extractEmail(message.getFrom()) === String(supportEmail).toLowerCase();
}

function isAutomatedMessage(message) {
  var from = extractEmail(message.getFrom());
  var subject = String(message.getSubject() || '').toLowerCase();
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
