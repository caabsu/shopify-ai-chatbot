/** Pure policy shared by planning and unattended execution. No model output can
 * establish a confirmation: it must be a later public customer message after
 * a successfully sent, server-recorded offer for this exact order. */
export const RETENTION_POLICY_VERSION = 'retention-30-v1';
export interface RetentionOffer {
  version: typeof RETENTION_POLICY_VERSION;
  order_id: string;
  order_name: string;
  refund_percent: 30;
}
export interface RetentionMessage {
  id?: string;
  sender_type: string;
  content: string;
  created_at?: string;
  is_internal_note?: boolean;
  metadata?: Record<string, unknown> | null;
}
export interface RetentionDecision {
  choice: 'cancel' | 'keep' | 'ambiguous' | 'none';
  orderId: string | null;
  offerMessageId?: string;
  confirmationMessageId?: string;
}
/** A full-refund request on an unshipped order is also a request to stop it.
 * This selects a target for an offer only; it never authorizes a mutation. */
export function shopifyMoneyAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?(?:\s+[A-Z]{3})?$/.test(value.trim())) return NaN;
  return Number(value.trim().split(/\s+/)[0]);
}
export function retentionOrderIdForRequests(input: {
  cancellationOrderIds: string[];
  refundRequests: ReadonlyMap<string, number | null>;
  orders: Array<{ id: string; totalPrice: string }>;
}): string | null {
  const requested = new Set(input.cancellationOrderIds);
  for (const [id, amount] of input.refundRequests) {
    const order = input.orders.find(candidate => candidate.id === id);
    const paid = shopifyMoneyAmount(order?.totalPrice);
    if (order && Number.isFinite(paid) && paid > 0 && (amount === null || amount >= paid)) requested.add(id);
  }
  return requested.size === 1 ? [...requested][0] : null;
}
export function authoredRetentionText(text: string): string {
  return text.split(/\n\s*(?:on\s+[^\n]{0,180}(?:\n[^\n]{0,180}){0,2}\bwrote:|from:\s|[-]{2,}\s*(?:original|forwarded)\s+message)/i)[0]
    .split('\n').filter(line => !/^\s*>/.test(line)).join('\n').replace(/[’‘]/g, "'").trim();
}
export function readRetentionOffer(value: unknown): RetentionOffer | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  return v.version === RETENTION_POLICY_VERSION && typeof v.order_id === 'string' && /^gid:\/\/shopify\/Order\/\d+$/.test(v.order_id)
    && typeof v.order_name === 'string' && Boolean(v.order_name) && v.refund_percent === 30 ? v as unknown as RetentionOffer : null;
}
export function retentionDecision(messages: RetentionMessage[]): RetentionDecision {
  const timeline = messages.filter(m => !m.is_internal_note && ['customer', 'agent'].includes(m.sender_type));
  const customer = [...timeline].reverse().find(m => m.sender_type === 'customer');
  if (!customer || !customer.id || !customer.created_at) return { choice: 'none', orderId: null };
  const offers = timeline.filter(m => m.sender_type === 'agent' && m.created_at && m.created_at < customer.created_at!
    && ['sent', 'delivered'].includes(String(m.metadata?.email_status)) && readRetentionOffer(m.metadata?.support_retention_offer));
  const offerMessage = offers.at(-1);
  const offer = readRetentionOffer(offerMessage?.metadata?.support_retention_offer);
  if (!offer || !offerMessage?.id) return { choice: 'none', orderId: null };
  const text = authoredRetentionText(customer.content).toLowerCase();
  const base = { orderId: offer.order_id, offerMessageId: offerMessage.id, confirmationMessageId: customer.id };
  // Questions, conditions, bare agreement and conflicting alternatives cannot
  // spend money. Keep the complete reply for a person to review instead.
  if (!text || /\?|\b(?:if|unless|otherwise|maybe|perhaps|might|or|not sure|haven't decided|previously|used to)\b/.test(text)
    || /\b(?:don't|do not|not|no longer)\s+(?:want to\s+)?(?:keep|accept|take)\b/.test(text)
    || Date.parse(customer.created_at) - Date.parse(offerMessage.created_at!) > 14 * 86400000) return { ...base, choice: 'ambiguous' };
  const cancel = /(?:^|[.!\n]\s*)(?:(?:yes[, ]+|please\s+|i\s+(?:still\s+)?(?:want|need|would like)\s+to\s+|i\s+confirm[, ]+|go ahead and\s+))*cancel\s+(?:it|this|that|my order|the order|order|#\d+)\b|\b(?:please proceed with (?:the )?cancellation|i confirm (?:the )?cancellation)\b/.test(text)
    && !/\b(?:don't|do not|no longer|not)\s+(?:want to\s+)?cancel\b/.test(text);
  const keep = /\b(?:keep (?:it|this|that|my order|the order|order)|accept (?:the |your )?30\s*%|take (?:the |your )?30\s*%|30\s*%\s*(?:refund|offer).{0,30}(?:accept|works|please))/.test(text);
  const differentOrder = [...text.matchAll(/#\s*([a-z0-9-]+)/g)].some(m => m[1] !== offer.order_name.replace(/^#/, '').toLowerCase());
  if (differentOrder || cancel === keep) return { ...base, choice: 'ambiguous' };
  return { ...base, choice: cancel ? 'cancel' : 'keep' };
}
export function retentionRefundAmount(totalPaid: number, alreadyRefunded: number): number | null {
  if (!Number.isFinite(totalPaid) || totalPaid <= 0 || !Number.isFinite(alreadyRefunded) || alreadyRefunded < 0) return null;
  // The retention concession is 30% total, not an additional 30% on retries.
  const cents = Math.round(totalPaid * 100);
  const outstanding = Math.round(cents * 0.30) - Math.round(alreadyRefunded * 100);
  return outstanding > 0 ? outstanding / 100 : null;
}
export function retentionDeliveryAllowed(brandSlug: string, address: { province?: string | null; provinceCode?: string | null } | null | undefined): boolean {
  if (brandSlug !== 'warm-by-design') return true;
  if (!address) return false;
  return ![address.province, address.provinceCode].some(value => /^(?:hi|hawaii)$/i.test(String(value ?? '').trim()));
}
export function addRetentionContext(offerText: string, additionalContext?: string): string {
  const context = additionalContext?.trim().slice(0, 4000);
  return context ? offerText.replace('\n\nYou can keep your order', `\n\n${context}\n\nYou can keep your order`) : offerText;
}
export function retentionOfferReply(input: { firstName: string; orderName: string; signoff: string; delayVerified: boolean; additionalContext?: string; shippingUpdate?: string; alreadyRefunded?: number }): string {
  const concession = (input.alreadyRefunded ?? 0) > 0
    ? 'receive a total refund of 30% of the amount paid, including any refund already issued'
    : 'receive a 30% refund of the amount paid';
  return addRetentionContext(`Hi ${input.firstName || 'there'},\n\nI'm sorry ${input.delayVerified ? 'for the wait with' : 'that you need to cancel'} order ${input.orderName}.${input.delayVerified ? ' I understand the delay is frustrating.' : ''}${input.shippingUpdate ? ` ${input.shippingUpdate}` : ''}\n\nYou can keep your order and ${concession}; your product will still be delivered. Or, if you prefer, we can cancel the order and refund the remaining payment.\n\nPlease reply with “keep my order” for the 30% refund, or “cancel my order” for cancellation. I'll take care of the option you choose.\n\n${input.signoff}`, input.additionalContext);
}
