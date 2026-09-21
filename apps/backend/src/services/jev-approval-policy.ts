import { contentHash, type DraftReview } from './support-ai.js';

/** The judgment must still describe the exact outbound text. A model's
 * probability is never substituted for customer authorization or live facts. */
export function jevApprovalError(input: {
  actions: Array<{ type: string; params: Record<string, unknown> }>;
  review?: DraftReview;
  required: boolean;
}): string | null {
  const replies = input.actions.filter(a => a.type === 'send_reply').map(a => String(a.params.reply_text ?? ''));
  if (!replies.length || !input.required) return null;
  if (!input.review || input.review.mode !== 'active' || input.review.status !== 'passed') {
    return 'Jev draft checks have not passed. Review and reassess this reply before threshold approval.';
  }
  if (input.review.draft_hash !== contentHash(replies.join('\n\n'))) {
    return 'The reply changed after its Jev assessment. Reassess the current reply before threshold approval.';
  }
  return null;
}
