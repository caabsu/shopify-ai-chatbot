import type { AutopilotAction } from './types';

export type CompletedMutationOutcome = 'cancel_order' | 'refund_order' | 'update_shipping_address';

const PATTERNS: Record<CompletedMutationOutcome, RegExp[]> = {
  cancel_order: [
    /\b(?:the\s+|your\s+)?(?:order\s+)?cancellation(?:\s+request)?\s+(?:(?:is|was|has\s+been)\s+(?:done|complete|completed|confirmed|successful|finalized|processed|handled|finished|all\s+set|taken\s+care\s+of)|(?:has\s+)?succeeded|went\s+through|has\s+gone\s+through)\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+(?:took\s+care\s+of|taken\s+care\s+of|completed|confirmed|finalized|processed|handled|finished)\s+(?:the\s+|your\s+)?(?:order\s+)?cancellation(?:\s+request)?\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+(?:now\s+|successfully\s+)?cancel(?:l)?ed\b/i,
    /\b(?:order|cancellation)\s+(?:has|have|was|is)\s+(?:now\s+|been\s+)?cancel(?:l)?ed\b/i,
    /\border\s+#?\s*[a-z0-9-]{3,}\s+(?:has|was|is)\s+(?:now\s+|been\s+)?cancel(?:l)?ed\b/i,
    /\bcancellation\s+(?:is\s+)?(?:complete|confirmed|done)\b/i,
    /\bcancellation(?:\s+request)?\s+(?:has|have|was|is)\s+(?:now\s+|been\s+)?(?:processed|completed)\b/i,
    /\bcancellation\s+(?:was|is)\s+successful\b/i,
    /\bcancellation\s+succeeded\b/i,
    /\bcancellation\s+(?:went|has gone)\s+through\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+(?:processed|completed)\s+(?:the\s+|your\s+)?cancellation\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+voided\s+(?:the\s+|your\s+)?order\b/i,
    /\border(?:\s+#?[a-z0-9_-]+)?\s+(?:has|was|is)\s+(?:now\s+|been\s+)?voided\b/i,
    /\b(?:i|we)\s+took\s+care\s+of\s+(?:the\s+|your\s+)?cancellation\b/i,
    /\b(?:i|we)(?:'ve| have)\s+taken\s+care\s+of\s+(?:the\s+|your\s+)?cancellation\b/i,
    /\b(?:order\s+)?cancellation\s+(?:is\s+)?all\s+set\b/i,
  ],
  refund_order: [
    /\b(?:your\s+|the\s+|a\s+)?(?:full\s+)?(?:refund|reimbursement)\s+(?:(?:is|was|has\s+been)\s+(?:done|complete|completed|confirmed|successful|finalized|processed|issued|submitted|handled|finished|all\s+set|taken\s+care\s+of)|(?:has\s+)?succeeded|went\s+through|has\s+gone\s+through)\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+(?:took\s+care\s+of|taken\s+care\s+of|completed|confirmed|finalized|processed|issued|submitted|handled|finished)\s+(?:your\s+|the\s+|a\s+)?(?:full\s+)?(?:refund|reimbursement)\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+(?:successfully\s+)?refunded\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+(?:now\s+)?issued\s+(?:your\s+|the\s+|a\s+)?(?:requested\s+)?(?:full\s+)?refund\b/i,
    /\brefund\s+(?:has|have|was|is)\s+(?:now\s+|been\s+)?(?:issued|processed|submitted|completed)\b/i,
    /\b(?:issued|processed|submitted)\s+(?:a\s+|the\s+)?refund\b/i,
    /\b(?:a|your|the)\s+(?:full\s+)?refund\s+(?:is|should be)\s+on\s+(?:its|the)\s+way\b/i,
    /\b(?:a|your|the)\s+(?:full\s+)?refund(?:\s+of\s+[^.!?\n]{1,40})?\s+(?:will|should)\s+(?:be\s+)?(?:returned|sent|credited|processed)\b/i,
    /\byou(?:'ll|\s+will)\s+(?:receive|get)\s+(?:a|the|your)?\s*(?:full\s+)?refund\b/i,
    /\b(?:i|we)(?:'ll|\s+will)\s+refund\s+(?:you|the\s+order|your\s+payment)\b/i,
    /\b(?:your|the)?\s*refund\s+(?:was|is|has\s+been)\s+(?:taken\s+care\s+of|all\s+set)\b/i,
    /\b(?:your|the)?\s*refund\s+(?:went|has\s+gone)\s+through\b/i,
    /\b(?:your|the)?\s*refund\s+(?:is|was|has\s+been)\s+(?:complete|completed|done)\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+completed\s+(?:your|the|a)\s+refund\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+finalized\s+(?:your|the|a)\s+refund\b/i,
    /\b(?:i|we)\s+took\s+care\s+of\s+(?:your|the|a)\s+refund\b/i,
    /\b(?:your|the)?\s*refund\s+(?:was|is)\s+successful\b/i,
    /\b(?:your|the)?\s*refund\s+succeeded\b/i,
    /\brefund\b[^\n]{0,120}\b(?:has\s+been|was|is)\s+(?:processed|issued|submitted|completed|successful)\b/i,
  ],
  update_shipping_address: [
    /\b(?:your\s+|the\s+)?(?:(?:shipping|delivery)\s+)?address\s+(?:update|change|correction)\s+(?:(?:is|was|has\s+been)\s+(?:done|complete|completed|confirmed|successful|finalized|processed|handled|finished|all\s+set|taken\s+care\s+of)|(?:has\s+)?succeeded|went\s+through|has\s+gone\s+through)\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+(?:took\s+care\s+of|taken\s+care\s+of|completed|confirmed|finalized|processed|handled|finished)\s+(?:the\s+|your\s+)?(?:(?:shipping|delivery)\s+)?address\s+(?:update|change|correction)\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+(?:updated|changed|corrected)\s+(?:your|the)\s+(?:shipping\s+)?address\b/i,
    /\b(?:shipping\s+)?address\s+(?:has|have|was|is)\s+(?:now\s+|been\s+)?(?:updated|changed|corrected)\b/i,
    /\b(?:shipping\s+)?address(?:\s+change)?\s+(?:is\s+)?all\s+set\b/i,
    /\b(?:i|we)\s+took\s+care\s+of\s+(?:the\s+|your\s+)?(?:shipping\s+)?address(?:\s+change)?\b/i,
    /\b(?:your|the)?\s*(?:shipping\s+)?address\s+(?:update|change)\s+(?:was|is)\s+successful\b/i,
    /\b(?:your|the)?\s*(?:shipping\s+)?address\s+change\s+succeeded\b/i,
  ],
};

export function claimedCompletedOutcomes(replyText: string): CompletedMutationOutcome[] {
  return (Object.entries(PATTERNS) as Array<[CompletedMutationOutcome, RegExp[]]>)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(replyText)))
    .map(([outcome]) => outcome);
}

function claimedCurrencyAmounts(replyText: string): number[] {
  return [...new Set(
    [...replyText.matchAll(/(?:[$£€]\s*|\b(?:usd|cad|aud|eur|gbp)\s+)(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:dollars?|usd|cad|aud|eur|gbp)\b/gi)]
      .map((match) => Number((match[1] ?? match[2]).replace(/,/g, '')))
      .filter((value) => Number.isFinite(value)),
  )];
}

function actionSatisfies(action: AutopilotAction, outcome: CompletedMutationOutcome): boolean {
  return action.type === outcome || (
    action.type === 'cancel_order'
    && outcome === 'refund_order'
    && (action.params.refund_verified === true || action.params.refund_expected === true)
  );
}

function orderReferences(text: string): Set<string> {
  const contextual = [...text.matchAll(/(?:\border\s+(?:number\s*)?#?\s*|#\s*)([a-z0-9][a-z0-9_-]{1,63})\b/gi)]
      .map((match) => match[1].toLowerCase())
      .filter((reference) => /\d/.test(reference));
  const prefixed = [...text.matchAll(/\b([a-z][a-z0-9_-]*\d[a-z0-9_-]*)\b/gi)]
    .map((match) => match[1].toLowerCase());
  return new Set([...contextual, ...prefixed].map((reference) => `#${reference}`));
}

function actionOrderReference(action: AutopilotAction): string | null {
  const name = typeof action.params.order_name === 'string' ? action.params.order_name.trim().toLowerCase() : '';
  if (!name) return null;
  return name.startsWith('#') ? name.replace(/\s+/g, '') : `#${name.replace(/\s+/g, '')}`;
}

export function validateFinalReplyOutcomes(input: {
  replyText: string;
  actions: AutopilotAction[];
  actionIsAvailable: (action: AutopilotAction) => boolean;
  historicalOutcomes?: Iterable<string>;
  historicalOutcomeEvidence?: Array<{ type: string; order_name?: string | null; amount?: number | null }>;
  /** Server-derived reviewer facts for a still-pending alternate payout. */
  verifiedPendingRefundAmounts?: Iterable<number>;
}): { ok: true } | { ok: false; error: string } {
  const claims = claimedCompletedOutcomes(input.replyText);
  const available = input.actions.filter(input.actionIsAvailable);
  const statedRefundAmounts = /\brefund\b/i.test(input.replyText)
    ? claimedCurrencyAmounts(input.replyText)
    : [];
  const verifiedRefundAmounts = available
    .filter((action) => action.type === 'refund_order')
    .map((action) => Number(action.params.amount))
    .filter(Number.isFinite)
    .concat(
      (input.historicalOutcomeEvidence ?? [])
        .filter((evidence) => evidence.type === 'refund_order')
        .map((evidence) => Number(evidence.amount))
        .filter(Number.isFinite),
      [...(input.verifiedPendingRefundAmounts ?? [])]
        .map(Number)
        .filter(Number.isFinite),
    );
  const unsupportedAmount = statedRefundAmounts.find((amount) => (
    !verifiedRefundAmounts.some((verified) => Math.abs(verified - amount) < 0.005)
  ));
  if (unsupportedAmount !== undefined) {
    return {
      ok: false,
      error: `The reply quotes a ${unsupportedAmount.toFixed(2)} refund, but no approved refund action verifies that exact amount.`,
    };
  }
  if (claims.length === 0) return { ok: true };

  for (const claim of claims) {
    const satisfying = available.filter((action) => actionSatisfies(action, claim));
    const historicalSatisfying = (input.historicalOutcomeEvidence ?? [])
      .filter((evidence) => evidence.type === claim);
    // Historical facts only satisfy that exact fact. A past cancellation does
    // not establish that a refund was ever issued.
    if (satisfying.length === 0 && historicalSatisfying.length === 0) {
      return {
        ok: false,
        error: `The reply says ${claim.replace(/_/g, ' ')} is complete, but no matching action is approved and verified.`,
      };
    }

    const claimSentences = input.replyText
      .split(/(?<=[.!?])\s+|\n+/)
      .filter((sentence) => PATTERNS[claim].some((pattern) => pattern.test(sentence)));
    const referencedOrders = new Set(claimSentences.flatMap((sentence) => [...orderReferences(sentence)]));
    if (referencedOrders.size > 0) {
      const allowedOrders = new Set([
        ...satisfying.map(actionOrderReference).filter((value): value is string => Boolean(value)),
        ...historicalSatisfying
          .map((evidence) => evidence.order_name
            ? (evidence.order_name.startsWith('#') ? evidence.order_name : `#${evidence.order_name}`)
              .toLowerCase()
              .replace(/\s+/g, '')
            : null)
          .filter((value): value is string => Boolean(value)),
      ]);
      // A reviewer may verify a historical outcome for an external/legacy
      // order that cannot be resolved in the current brand's Shopify store.
      // Bind that one unscoped fact to the reply only when the reply names
      // exactly one order and no live mutation action is being used as proof.
      // Multi-order replies and mismatched live actions continue to fail
      // closed, so this cannot authorize a Shopify mutation on another order.
      const soleUnboundHistoricalFact = (
        satisfying.length === 0
        && historicalSatisfying.length === 1
        && !historicalSatisfying[0].order_name
        && referencedOrders.size === 1
      );
      if (soleUnboundHistoricalFact) {
        allowedOrders.add([...referencedOrders][0]);
      }
      const mismatch = [...referencedOrders].find((reference) => !allowedOrders.has(reference));
      if (mismatch) {
        return {
          ok: false,
          error: `The reply claims a completed action for ${mismatch}, but the approved action targets a different order.`,
        };
      }
    }
  }
  return { ok: true };
}
