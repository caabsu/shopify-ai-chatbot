const WEBHOOK_URL = 'https://shopify-ai-chatbot-production-9ab4.up.railway.app/api/webhooks/email';
const BRAND = 'warm-by-design';
const SUPPORT_EMAIL = 'support@warmbydesign.com';
const PROCESSED_LABEL = 'AI-Tickets/Processed';
const FAILED_LABEL = 'AI-Tickets/Failed';
// Gmail labels belong to a whole conversation. Excluding the Processed label
// also excludes later customer replies in that conversation.
const QUERY = `to:${SUPPORT_EMAIL} newer_than:14d`;

function processWarmSupportEmails() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try { syncWarmSupportEmails(); } finally { lock.releaseLock(); }
}

// Run once to request a complete mailbox pass. The existing timed trigger
// continues the paginated pass; RFC Message-ID deduplication preserves tickets.
function backfillWarmSupportEmails() {
  PropertiesService.getScriptProperties().setProperties({ WBD_BACKFILL_ALL: '1', WBD_SYNC_CURSOR: '0' });
  processWarmSupportEmails();
}

function syncWarmSupportEmails() {
  const props = PropertiesService.getScriptProperties();
  const webhookSecret = props.getProperty('EMAIL_WEBHOOK_SECRET') || '';
  if (!webhookSecret) throw new Error('EMAIL_WEBHOOK_SECRET is required.');
  const processedLabel = getOrCreateLabel(PROCESSED_LABEL);
  const failedLabel = getOrCreateLabel(FAILED_LABEL);
  const backfill = props.getProperty('WBD_BACKFILL_ALL') === '1';
  const cursor = Math.max(0, Number(props.getProperty('WBD_SYNC_CURSOR')) || 0);
  const query = backfill ? `to:${SUPPORT_EMAIL}` : QUERY;
  // Always check the newest page while advancing through older threads.
  const recent = GmailApp.search(QUERY, 0, 20);
  const page = cursor > 0 || backfill ? GmailApp.search(query, cursor, 20) : recent;
  const threads = [...new Map([...recent, ...page].map(t => [t.getId(), t])).values()];
  let failed = false;

  for (const thread of threads) {
    try {
      const messages = thread.getMessages();
      const latest = messages[messages.length - 1];
      const checkpoint = `WBD_THREAD_${thread.getId()}`;
      const lastSeen = props.getProperty(checkpoint);
      if (!latest || lastSeen === latest.getId()) continue;
      if (!latest || isFromSupport(latest) || isAutomatedMessage(latest)) {
        thread.addLabel(processedLabel);
        props.setProperty(checkpoint, latest.getId());
        continue;
      }

      const payload = {
        from_email: extractEmail(latest.getFrom()),
        from_name: extractName(latest.getFrom()),
        to_email: SUPPORT_EMAIL,
        recipient: SUPPORT_EMAIL,
        subject: latest.getSubject() || '(No Subject)',
        text: latest.getPlainBody() || '',
        html: latest.getBody() || '',
        message_id: latest.getHeader('Message-ID') || latest.getId(),
        in_reply_to: latest.getHeader('In-Reply-To') || '',
        references: latest.getHeader('References') || '',
        thread_messages: messages.map((message) => ({
          from_email: extractEmail(message.getFrom()),
          from_name: extractName(message.getFrom()),
          text: message.getPlainBody() || '',
          body: message.getPlainBody() || '',
          message_id: message.getHeader('Message-ID') || message.getId(),
          date: message.getDate().toISOString(),
        })),
      };

      const response = UrlFetchApp.fetch(`${WEBHOOK_URL}?brand=${encodeURIComponent(BRAND)}`, {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        headers: webhookSecret ? { Authorization: `Bearer ${webhookSecret}` } : {},
        payload: JSON.stringify(payload),
      });

      const status = response.getResponseCode();
      if (status < 200 || status >= 300) {
        throw new Error(`Webhook returned ${status}: ${response.getContentText()}`);
      }

      thread.addLabel(processedLabel);
      thread.removeLabel(failedLabel);
      props.setProperty(checkpoint, latest.getId());
    } catch (err) {
      console.error(err);
      thread.addLabel(failedLabel);
      failed = true;
    }
  }
  // Retry a failed page, rather than advancing past an unimported email.
  if (!failed) {
    props.setProperty('WBD_SYNC_CURSOR', page.length < 20 ? '0' : String(cursor + 20));
    if (backfill && page.length < 20) {
      props.deleteProperty('WBD_BACKFILL_ALL');
      console.log('Warm by Design full mailbox pass complete.');
    }
  }
}

function getOrCreateLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function extractEmail(value) {
  const match = String(value || '').match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

function extractName(value) {
  return String(value || '').replace(/<[^>]+>/g, '').replace(/"/g, '').trim();
}

function isFromSupport(message) {
  return extractEmail(message.getFrom()) === SUPPORT_EMAIL;
}

function isAutomatedMessage(message) {
  const from = extractEmail(message.getFrom());
  const subject = String(message.getSubject() || '').toLowerCase();
  return [
    'security@',
    'account-security',
    'no-reply@',
    'noreply@',
    'notification@',
    'notifications@',
    'mailer-daemon@',
    'postmaster@',
  ].some((part) => from.includes(part))
    || [
      '@mail.instagram.com',
      '@facebookmail.com',
      '@accounts.google.com',
      '@google.com',
      '@shopify.com',
    ].some((domain) => from.endsWith(domain))
    || [
      'two-factor authentication',
      'new login',
      'security alert',
      'verification code',
      'password reset',
      'delivery status notification',
      'undeliverable',
    ].some((part) => subject.includes(part));
}
