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
    const parsed = JSON.parse(text.trim());

    return {
      classification: parsed.classification as EmailClassification,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      reason: parsed.reason || '',
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
