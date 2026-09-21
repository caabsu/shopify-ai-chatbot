import { supabase } from '../config/supabase.js';
import { jevEnabledForBrand, scopedJev } from './jev-store.js';
import type { RequiredToolDefinition } from './deepseek-tool-call.service.js';
import {
  callSupportRequiredTool,
  type SupportModelGeneration,
} from './support-model-tool.service.js';
import { recordSupportGenerationRun } from './ai-generation-ledger.service.js';

export const EMAIL_CLASSIFIER_PROMPT_VERSION = 'email-classifier-2026-07-deepseek-v1';

export type EmailClassification =
  | 'customer_support'
  | 'promotional'
  | 'transactional'
  | 'automated'
  | 'spam'
  | 'internal';

export interface ClassificationResult {
  classification: EmailClassification;
  confidence: number;
  reason: string;
  generation?: SupportModelGeneration;
}

const VALID_CLASSIFICATIONS = new Set<EmailClassification>([
  'customer_support',
  'promotional',
  'transactional',
  'automated',
  'spam',
  'internal',
]);

const CLASSIFY_TOOL: RequiredToolDefinition = {
  name: 'classify_inbound_email',
  description: 'Classify one inbound email for support intake.',
  inputSchema: {
    type: 'object',
    required: ['classification', 'confidence', 'reason'],
    properties: {
      classification: { type: 'string', enum: [...VALID_CLASSIFICATIONS] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reason: { type: 'string' },
    },
  },
};

/**
 * Classify an inbound email. Flash/non-thinking is sufficient here because the
 * task is bounded, forced into a schema, and defaults to customer_support on
 * any uncertainty so real requests are never silently lost.
 */
export async function classifyEmail(opts: {
  from: string;
  subject: string;
  body: string;
  brandId?: string;
}): Promise<ClassificationResult> {
  const { from, subject, body } = opts;
  const deterministic = classifyEmailDeterministically(from, subject);
  if (deterministic) return deterministic;
  if (opts.brandId && jevEnabledForBrand(opts.brandId)) {
    const intake = await scopedJev(supabase, opts.brandId).intake({
      subject, thread: `[customer: ${from}] ${body}`, latest_message: body,
      latest_sender: 'customer', has_prior_agent_reply: false, has_attachments: false,
    });
    if (intake.evaluation.mode === 'active' && intake.evaluation.status === 'completed') {
      return { classification: intake.classification as EmailClassification,
        confidence: intake.classification_probability,
        reason: `Jev ${intake.evaluation.model}: ${intake.classification_requires_review ? 'uncertain classification retained for support review' : intake.classification}` };
    }
  }


  const truncatedBody = body.length > 2_000 ? `${body.slice(0, 2_000)}...` : body;
  try {
    const response = await callSupportRequiredTool<{
      classification?: string;
      confidence?: number;
      reason?: string;
    }>({
      tier: 'flash',
      max_tokens: 300,
      system: `Classify inbound email for a Shopify support desk.

Definitions:
- customer_support: a real person asking for help, reporting an issue, asking about orders/returns/products, or following up
- promotional: marketing, newsletters, sale announcements, or partner outreach
- transactional: automated receipts, shipping/payment notices, chargebacks, disputes, or fraud alerts
- automated: auto-replies, out-of-office, delivery failures, or system notifications
- spam: unsolicited junk, phishing, or scams
- internal: team, vendor, or business-to-business communication

Choose exactly one category. Be conservative: uncertain mail stays customer_support.`,
      user: `From: ${from}\nSubject: ${subject}\nBody:\n${truncatedBody}`,
      tool: CLASSIFY_TOOL,
      parse(value) {
        if (!value || typeof value !== 'object') throw new Error('Classifier tool input must be an object');
        return value as { classification?: string; confidence?: number; reason?: string };
      },
    });

    const parsed = response.value;
    await recordSupportGenerationRun({
      purpose: 'email_classification',
      generation: response.generation,
      promptVersion: EMAIL_CLASSIFIER_PROMPT_VERSION,
      routerVersion: 'email-classifier-router-v1',
      routerDecision: { tier: 'flash', reason: 'bounded_intent_detection' },
    });
    const classification = VALID_CLASSIFICATIONS.has(parsed.classification as EmailClassification)
      ? parsed.classification as EmailClassification
      : 'customer_support';
    const confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0;
    return {
      classification,
      confidence,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 500) : '',
      generation: response.generation,
    };
  } catch (error) {
    console.error('[email-classifier] Classification failed:', error instanceof Error ? error.message : error);
    return {
      classification: 'customer_support',
      confidence: 0,
      reason: 'Classification failed — defaulting to customer_support',
    };
  }
}

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

export function classifyEmailDeterministically(from: string, subject: string): ClassificationResult | null {
  const sender = from.toLowerCase();
  const normalizedSubject = subject.toLowerCase();
  const automatedSenderParts = [
    'security@',
    'account-security',
    'no-reply@',
    'noreply@',
    'noreply-',
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
    automatedSenderParts.some((part) => sender.includes(part))
    || automatedDomains.some((domain) => sender.endsWith(domain))
    || automatedSubjectParts.some((part) => normalizedSubject.includes(part))
  ) {
    return {
      classification: 'automated',
      confidence: 1,
      reason: 'Matched deterministic automated email pattern',
      generation: {
        access_provider: 'rules',
        provider: 'rules',
        model: 'email-classifier-rules-v1',
        requested_model: 'email-classifier-rules-v1',
        tier: 'flash',
        thinking: 'disabled',
        latency_ms: 0,
        usage: {},
      },
    };
  }

  const selfMarketingSenders = new Set([
    'info@outlight.us',
  ]);
  const selfMarketingSubjectParts = [
    'sale ends',
    'last chance',
    'our lamps vs.',
    'better lighting',
  ];
  if (
    selfMarketingSenders.has(sender.trim())
    && selfMarketingSubjectParts.some((part) => normalizedSubject.includes(part))
  ) {
    return {
      classification: 'promotional',
      confidence: 1,
      reason: 'Matched deterministic self-sent marketing campaign pattern',
      generation: {
        access_provider: 'rules',
        provider: 'rules',
        model: 'email-classifier-rules-v1',
        requested_model: 'email-classifier-rules-v1',
        tier: 'flash',
        thinking: 'disabled',
        latency_ms: 0,
        usage: {},
      },
    };
  }

  return null;
}
