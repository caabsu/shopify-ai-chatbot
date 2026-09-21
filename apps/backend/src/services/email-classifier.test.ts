import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyEmailDeterministically } from './email-classifier.service.js';

test('Google Apps Script failure notifications are automated, not support tickets', () => {
  const result = classifyEmailDeterministically(
    'noreply-apps-scripts-notifications@google.com',
    'Summary of failures for Google Apps Script: Support Inbox Webhook',
  );
  assert.equal(result?.classification, 'automated');
  assert.equal(result?.confidence, 1);
});

test('known self-sent campaign subjects are promotional', () => {
  const result = classifyEmailDeterministically(
    'info@outlight.us',
    'Last Chance: Spring Sale Ends Tonight',
  );
  assert.equal(result?.classification, 'promotional');
  assert.equal(result?.confidence, 1);
});

test('uncertain human mail is never reclassified by deterministic rules', () => {
  assert.equal(
    classifyEmailDeterministically('customer@example.com', 'Where is my order?'),
    null,
  );
});
