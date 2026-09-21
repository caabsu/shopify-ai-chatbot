import type { DeepSeekModelTier } from './deepseek-tool-call.service.js';

export interface StorefrontModelRoute {
  tier: DeepSeekModelTier;
  thinking: 'disabled' | 'high';
  reasons: string[];
  router_version: 'storefront-router-v1';
}

export interface StorefrontModelRoutingInput {
  currentMessage: string;
  priorCustomerMessages?: string[];
}

const PRIVILEGED_TOOLS = new Set([
  'cancel_order',
  'initiate_return',
]);

/**
 * A Flash response is never allowed to execute one of these tools. This guard
 * protects against an imperfect initial intent route: the same model turn is
 * replayed on Pro before any privileged side effect occurs.
 */
export function storefrontToolRequiresPro(toolName: string): boolean {
  return PRIVILEGED_TOOLS.has(toolName);
}

function orderReferences(text: string): Set<string> {
  const references = new Set<string>();
  for (const match of text.matchAll(/(?:\border(?:\s+(?:number\s*)?)?#?\s*|#)(\d{3,})\b/gi)) {
    if (match[1]) references.add(match[1]);
  }
  return references;
}

function hasConflictingInstruction(text: string): boolean {
  const asksToCancel = /\b(?:please|want|need|like|can|could|would|able)\b[^.!?\n]{0,80}\bcancel\b/i.test(text);
  const revokesCancellation = /\b(?:do not|don't|dont|no longer)\b[^.!?\n]{0,50}\bcancel\b|\b(?:never\s*mind|nevermind|changed my mind|keep (?:my |the )?order|hold off)\b/i
    .test(text);
  const asksForRefund = /\b(?:please|want|need|like|issue|process|send|get|receive)\b[^.!?\n]{0,80}\brefund\b/i.test(text);
  const revokesRefund = /\b(?:do not|don't|dont|no longer)\b[^.!?\n]{0,50}\brefund\b|\b(?:never\s*mind|nevermind|changed my mind)\b/i
    .test(text);
  return (asksToCancel && revokesCancellation) || (asksForRefund && revokesRefund);
}

/**
 * Deterministic cost/risk router for the public storefront assistant.
 * Ordinary product discovery, policy lookup, tracking, and cart help stay on
 * Flash. Money/order mutations, ambiguity, and sensitive exceptions start on
 * Pro.
 */
export function selectStorefrontModel(
  input: StorefrontModelRoutingInput,
): StorefrontModelRoute {
  const history = [...(input.priorCustomerMessages ?? []), input.currentMessage].join('\n');
  const reasons: string[] = [];

  if (
    /\b(?:cancel(?:lation)?|refund|return|exchange|change (?:the )?(?:shipping )?address|update (?:the )?(?:shipping )?address|modify (?:the )?order|add (?:an? |the )?item to (?:my |the )?order|remove (?:an? |the )?item from (?:my |the )?order|damaged|defective|wrong item)\b/i
      .test(input.currentMessage)
  ) {
    reasons.push('mutation_return_or_damage');
  }

  if (orderReferences(history).size > 1) reasons.push('multiple_orders');
  if (hasConflictingInstruction(history)) reasons.push('conflicting_customer_instruction');

  if (
    /\b(?:chargeback|payment dispute|fraud|legal|attorney|lawsuit|warranty|policy exception|manager exception|outside (?:the )?(?:return|refund) window)\b/i
      .test(history)
  ) {
    reasons.push('uncertain_or_sensitive_policy');
  }

  const tier: DeepSeekModelTier = reasons.length ? 'pro' : 'flash';
  return {
    tier,
    thinking: tier === 'pro' ? 'high' : 'disabled',
    reasons: reasons.length ? reasons : ['routine_or_read_only'],
    router_version: 'storefront-router-v1',
  };
}
