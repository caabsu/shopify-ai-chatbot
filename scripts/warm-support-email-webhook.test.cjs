const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture() {
  const values = new Map([['EMAIL_WEBHOOK_SECRET', 'test-secret']]);
  const queries = [];
  const payloads = [];
  let status = 200;
  const message = id => ({
    getId: () => id, getFrom: () => 'Customer <customer@example.com>',
    getSubject: () => 'Order update', getPlainBody: () => 'Where is my order?',
    getBody: () => 'Where is my order?', getDate: () => new Date('2026-09-16'),
    getHeader: key => key === 'Message-ID' ? `<${id}@example.com>` : '',
  });
  const thread = { getId: () => 'thread-1', getMessages: () => messages,
    addLabel() {}, removeLabel() {} };
  let messages = [message('message-1')];
  const props = { getProperty: k => values.get(k), setProperty: (k,v) => values.set(k,v),
    setProperties: entries => Object.entries(entries).forEach(([k,v]) => values.set(k,v)),
    deleteProperty: k => values.delete(k) };
  const context = vm.createContext({
    console: {log() {}, error() {}},
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({tryLock: () => true, releaseLock() {}}) },
    GmailApp: {getUserLabelByName: name => name,
      search: (query, cursor) => { queries.push({query,cursor}); return cursor ? [] : [thread]; }},
    UrlFetchApp: {fetch: (_url, options) => {payloads.push(JSON.parse(options.payload));return {getResponseCode:()=>status,getContentText:()=>''};}},
  });
  vm.runInContext(fs.readFileSync('scripts/warm-support-email-webhook.gs','utf8'),context);
  return {context,values,queries,payloads,reply:()=>messages.push(message('message-2')),fail:()=>status=503};
}

test('a new reply in a previously processed Gmail thread is forwarded exactly once', () => {
  const f = fixture();
  f.context.processWarmSupportEmails();
  f.context.processWarmSupportEmails();
  assert.equal(f.payloads.length,1);
  f.reply();
  f.context.processWarmSupportEmails();
  assert.equal(f.payloads.length,2);
  assert.equal(f.payloads[1].message_id,'<message-2@example.com>');
  assert.equal(f.payloads[1].thread_messages.length,2);
  assert.ok(f.queries.every(q=>!q.query.includes('-label:')));
});

test('failed delivery never advances the mailbox cursor or marks the message imported', () => {
  const f = fixture(); f.values.set('WBD_SYNC_CURSOR','20'); f.fail();
  f.context.processWarmSupportEmails();
  assert.equal(f.values.get('WBD_SYNC_CURSOR'),'20');
  assert.equal(f.values.has('WBD_THREAD_thread-1'),false);
});

test('full backfill searches older mail without clearing existing labels or deleting tickets', () => {
  const f = fixture(); f.context.backfillWarmSupportEmails();
  assert.ok(f.queries.some(q=>q.query==='to:support@warmbydesign.com'));
  assert.equal(f.values.has('WBD_BACKFILL_ALL'),false);
  assert.equal(f.payloads.length,1);
});
