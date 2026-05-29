import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

export type EmailClassification =
  | 'customer_support'
  | 'promotional'
  | 'transactional'
  | 'automated'
  | 'spam'
  | 'internal';

export interface ClassificationResult {
  classification: EmailClassification;
  confidence: number; // 0-1
  reason: string;
}

const VALID_CLASSIFICATIONS = new Set<EmailClassification>([
  'customer_support',
  'promotional',
  'transactional',
  'automated',
  'spam',
  'internal',
]);

/**
 * Robustly extract a classification JSON object from a model response.
 * Handles ```json code fences, surrounding prose, and bare JSON — the raw
 * `JSON.parse(text.trim())` used previously threw on fenced output (which Haiku
 * emits), silently degrading every classification to the error fallback.
 */
function parseClassificationJson(text: string): { classification?: string; confidence?: number; reason?: string } | null {
  if (!text) return null;

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const withoutFences = text
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  const candidates = [withoutFences];
  // Also try the first balanced-looking {...} block in case prose surrounds it.
  const braceMatch = withoutFences.match(/\{[\s\S]*\}/);
  if (braceMatch) candidates.push(braceMatch[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}

/**
 * Classify an inbound email using AI to determine if it's a real customer support request.
 * Returns classification, confidence score, and reasoning.
 */
export async function classifyEmail(opts: {
  from: string;
  subject: string;
  body: string;
}): Promise<ClassificationResult> {
  const { from, subject, body } = opts;
  const deterministic = classifyDeterministically(from, subject);
  if (deterministic) return deterministic;

  // Truncate body to avoid excessive token usage
  const truncatedBody = body.length > 2000 ? body.slice(0, 2000) + '...' : body;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Classify this inbound email. Respond ONLY with valid JSON, no other text.

From: ${from}
Subject: ${subject}
Body:
${truncatedBody}

Classify as exactly one of: "customer_support", "promotional", "transactional", "automated", "spam", "internal"

Definitions:
- customer_support: A real person asking for help, reporting an issue, asking about orders/returns/products, or following up on a previous request
- promotional: Marketing emails, newsletters, sale announcements, partner outreach
- transactional: Automated receipts, shipping notifications, payment confirmations, chargeback notices, dispute notifications, fraud alerts from banks or payment processors
- automated: Auto-replies, out-of-office, delivery failure notices, system notifications
- spam: Unsolicited junk, phishing, scam emails
- internal: Emails between team members, vendor communications, business-to-business

Respond with JSON: {"classification":"...","confidence":0.0-1.0,"reason":"brief reason"}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const parsed = parseClassificationJson(text);
    if (!parsed) {
      console.warn('[email-classifier] Could not parse model output, keeping as customer_support:', text.slice(0, 200));
      return {
        classification: 'customer_support',
        confidence: 0,
        reason: 'Unparseable classifier output — defaulting to customer_support',
      };
    }

    const classification = VALID_CLASSIFICATIONS.has(parsed.classification as EmailClassification)
      ? (parsed.classification as EmailClassification)
      : 'customer_support';
    const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;

    return {
      classification,
      confidence,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    };
  } catch (err) {
    console.error('[email-classifier] Classification failed:', err instanceof Error ? err.message : err);
    // Default to customer_support on failure so we don't lose real tickets
    return {
      classification: 'customer_support',
      confidence: 0,
      reason: 'Classification failed — defaulting to customer_support',
    };
  }
}

/**
 * Bulk classify open tickets that don't have a classification yet.
 * Returns array of { ticketId, classification, confidence, reason }.
 */
export async function classifyTicketContent(opts: {
  subject: string;
  customerEmail: string;
  firstMessage: string;
}): Promise<ClassificationResult> {
  return classifyEmail({
    from: opts.customerEmail,
    subject: opts.subject,
    body: opts.firstMessage,
  });
}

function classifyDeterministically(from: string, subject: string): ClassificationResult | null {
  const sender = from.toLowerCase();
  const normalizedSubject = subject.toLowerCase();
  const automatedSenderParts = [
    'security@',
    'account-security',
    'no-reply@',
    'noreply@',
    'notification@',
    'notifications@',
    'mailer-daemon@',
    'postmaster@',
  ];
  const automatedDomains = [
    '@mail.instagram.com',
    '@facebookmail.com',
    '@accounts.google.com',
    '@google.com',
    '@shopify.com',
  ];
  const automatedSubjectParts = [
    'two-factor authentication',
    'new login',
    'security alert',
    'verification code',
    'password reset',
    'delivery status notification',
    'undeliverable',
  ];

  if (
    automatedSenderParts.some((part) => sender.includes(part)) ||
    automatedDomains.some((domain) => sender.endsWith(domain)) ||
    automatedSubjectParts.some((part) => normalizedSubject.includes(part))
  ) {
    return {
      classification: 'automated',
      confidence: 1,
      reason: 'Matched deterministic automated email pattern',
    };
  }

  return null;
}
