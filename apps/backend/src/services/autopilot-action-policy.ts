export type AutopilotMutationOutcome =
  | 'cancel_order'
  | 'refund_order'
  | 'update_shipping_address';

export interface CancellationPlanPolicy {
  restock: boolean;
  confidenceCap: number;
  observedFulfillmentStatus: string;
  trackingPresent: boolean;
  riskNote: string | null;
}

export interface CancellationRequestOrder {
  id: string;
  name: string;
  cancelledAt?: string | null;
  totalPrice?: string | number | null;
  totalRefunded?: string | number | null;
  financialStatus?: string | null;
  lineItems?: Array<{ title: string }>;
}

export interface CancellationRequestMessage {
  sender_type: string;
  content: string;
  is_internal_note?: boolean;
  metadata?: Record<string, unknown> | null;
}

export function passesRelatedTicketCandidateGate(input: {
  score: number;
  basis: string[];
  deterministic: boolean;
}): boolean {
  if (input.deterministic) return true;
  if (input.score < 0.7) return false;
  // A shared order is customer-level context, not proof that two contacts are
  // the same support case. Destructive consolidation always needs a topical
  // signal as well (matching intent or a meaningfully similar subject).
  return input.basis.includes('same_intent')
    || input.basis.includes('same_subject')
    || input.basis.includes('same_topic_signal');
}

export function automaticSameCaseTicketIds(
  candidates: Array<{ ticket_id: string; relation_reason: string }>,
): string[] {
  return candidates
    .filter((ticket) => {
      const reason = ticket.relation_reason.toLowerCase();
      return reason.includes('same chat escalation')
        || reason.includes('same subject')
        || (
          reason.includes('same order reference')
          && (reason.includes('same intent') || reason.includes('same topic signal'))
        )
        || (
          !reason.includes('different order reference')
          && reason.includes('same intent')
          && reason.includes('same topic signal')
          && reason.includes('within 14 days')
        );
    })
    .map((ticket) => ticket.ticket_id);
}

export function authoredCustomerTextPreservingCase(customerText: string): string {
  return customerText
    .split(/\n\s*(?:-{2,}\s*(?:forwarded|original)\s+message\s*-{2,}|on\s+[^\n]{0,180}(?:\n[^\n]{0,180}){0,2}\bwrote:|from:\s+[^\n]+\n(?:sent|date|subject):)/i)[0]
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'");
}

export function authoredCustomerText(customerText: string): string {
  return authoredCustomerTextPreservingCase(customerText).toLowerCase();
}

function orderReferenceTokens(text: string): Set<string> {
  const isPlausibleShopifyOrderName = (reference: string): boolean => {
    const normalized = reference.trim().replace(/^#/, '');
    // Shopify order names in the connected stores are short numeric IDs or a
    // configured alphabetic prefix followed by digits (for example WBD1025).
    // Email security rewrites and tracking links contain long mixed
    // alphanumeric tokens; never send those through Admin order lookup.
    if (normalized.length < 2 || normalized.length > 24) return false;
    return /^\d{2,12}$/.test(normalized)
      || /^wbd[-_]?\d{1,12}$/i.test(normalized);
  };
  const followsAddressUnitLabel = (index: number): boolean => (
    /\b(?:apt|apartment|unit|suite|ste|floor|fl|room|rm)\s*#?\s*$/i
      .test(text.slice(Math.max(0, index - 24), index))
    || /\b(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way|highway|hwy)\s*$/i
      .test(text.slice(Math.max(0, index - 24), index))
  );
  const contextual = [...text.matchAll(/\border\s+(?:(?:number|no\.?)\s*)?(?:(?:is|:|=)\s*)?#?\s*([a-z0-9][a-z0-9_-]{1,63})\b/gi)]
    .map((match) => match[1].toLowerCase())
    .filter(isPlausibleShopifyOrderName);
  // A plural label applies to the whole adjacent list, including references
  // without hashtags. Do not scan unrelated bare numbers elsewhere in a mail.
  const lists = [...text.matchAll(/\b(?:orders\s+(?:(?:numbers?|nos?\.?)\s*)?|order\s+(?:numbers|nos\.?)\s*)(?:(?:are|is|:|=)\s*)?#?\s*([a-z0-9][a-z0-9_-]{1,63}(?:\s*(?:,\s*(?:and\s+)?|and\s+|&\s*)#?\s*[a-z0-9][a-z0-9_-]{1,63})*)/gi)]
    .flatMap((match) => match[1].match(/\b[a-z0-9][a-z0-9_-]{1,63}\b/gi) ?? [])
    .map((reference) => reference.toLowerCase())
    .filter(isPlausibleShopifyOrderName);
  const hashtags = [...text.matchAll(/#\s*([a-z0-9][a-z0-9_-]{1,63})\b/gi)]
    .filter((match) => !followsAddressUnitLabel(match.index ?? 0))
    .map((match) => match[1].toLowerCase())
    // Bare hashtag IDs from return/RMA systems often mix digits and letters
    // (for example #239C9A2F). Do not send those through Shopify order lookup.
    // Shopify order names here are numeric or a stable alphabetic prefix
    // followed by digits; explicit "order ..." references remain handled by
    // the contextual matcher above.
    .filter(isPlausibleShopifyOrderName);
  // Configured Shopify prefixes are often written without "order" or "#"
  // (for example WBD1025). Bare numeric tokens remain excluded so dates and
  // currency values cannot silently become order references.
  const prefixed = [...text.matchAll(/\b(wbd[-_]?\d{1,12})\b/gi)]
    .filter((match) => !followsAddressUnitLabel(match.index ?? 0))
    .filter((match) => {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      // Do not interpret the digit-bearing local part of an email address or
      // a URL/domain label as a configured Shopify order prefix.
      const before = text[start - 1] ?? '';
      const after = text[end] ?? '';
      const embeddedDomainLabel = (
        before === '.' && /[a-z0-9]/i.test(text[start - 2] ?? '')
      ) || (
        after === '.' && /[a-z0-9]/i.test(text[end + 1] ?? '')
      );
      return before !== '@' && after !== '@' && !embeddedDomainLabel;
    })
    .map((match) => match[1].toLowerCase())
    .filter(isPlausibleShopifyOrderName);
  return new Set([...contextual, ...lists, ...hashtags, ...prefixed].map((reference) => `#${reference}`));
}

export function proactivelyOffersOrderCancellationOrRefund(text: string): boolean {
  const normalized = text
    .replace(/[\u2018\u2019\u02bc\u2032]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return /\bif\s+you[^.!?\n]{0,120}\b(?:cancel|refund)\b/.test(normalized)
    || /\b(?:i|we)\s+can\s+(?:cancel|refund)\b/.test(normalized)
    || /\b(?:option|choice)\s+(?:of|to)\s+(?:cancel(?:ling)?|get(?:ting)?\s+(?:a\s+)?refund)\b/.test(normalized);
}

/** Permission to discuss an option is separate from permission to execute it. */
export function customerRaisedCancellationOrRefund(text: string): boolean {
  const authored = authoredCustomerText(text);
  return /\b(?:cancel(?:lation|l?ing)?|refund)\b/i.test(authored)
    && !revokesCancellationRequest(authored) && !revokesRefundRequest(authored);
}

export function canonicalizeReplyGreeting(text: string, customerName: string | null): string {
  const firstName = String(customerName ?? '')
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^a-z'.-]/gi, '');
  if (!firstName || firstName.length < 2) return text;
  const greeting = `Hi ${firstName[0].toUpperCase()}${firstName.slice(1)},`;
  if (/^\s*(?:hi|hello|hey)\b[^\n]*[,!.]\s*/i.test(text)) {
    return text.replace(/^\s*(?:hi|hello|hey)\b[^\n]*[,!.]\s*/i, `${greeting}\n\n`);
  }
  return `${greeting}\n\n${text.trimStart()}`;
}

export function referencedOrderNamesFromText(text: string): string[] {
  return [...orderReferenceTokens(text)];
}

export function referencedOrderNamesFromMessages(
  messages: CancellationRequestMessage[],
): string[] {
  const references = new Set<string>();
  for (const message of messages) {
    if (message.is_internal_note || message.sender_type !== 'customer') continue;
    for (const reference of orderReferenceTokens(authoredCustomerText(message.content))) {
      references.add(reference);
    }
  }
  return [...references];
}

export function customerNameCandidatesFromMessages(
  messages: CancellationRequestMessage[],
): string[] {
  const candidates = new Set<string>();
  const excluded = new Set([
    'thank you',
    'thanks again',
    'best regards',
    'kind regards',
    'warm regards',
    'customer support',
    'sent from my iphone',
    'sent from my ipad',
    'sent from my android',
    'my email address is',
    'real estate broker',
    'influencer marketing specialist',
  ]);
  const forbiddenWords = new Set([
    'address', 'best', 'broker', 'by', 'customer', 'email', 'from', 'go',
    'hello', 'hi', 'if', 'kind', 'looks', 'method', 'order', 'payment',
    'please', 'regards', 'sent', 'support', 'team', 'thank', 'thanks', 'warm',
    'you', 'tracking', 'free', 'standard', 'shipping', 'refund', 'fraud',
  ]);
  for (const message of [...messages].reverse()) {
    if (message.is_internal_note || message.sender_type !== 'customer') continue;
    const lines = authoredCustomerText(message.content)
      .split(/\r?\n/)
      .map((line) => line
        .replace(/^[\s*_~\-]+|[\s*_~\-.,:;!]+$/g, '')
        .replace(/^(?:by|from)\s+/i, '')
        .trim())
      .filter(Boolean)
      .slice(-12);
    for (const line of [...lines].reverse()) {
      if (excluded.has(line.toLowerCase())) continue;
      if (!/^[a-z][a-z'.-]{1,30}(?:\s+[a-z][a-z'.-]{1,30}){0,3}$/i.test(line)) continue;
      const words = line.toLowerCase().split(/\s+/);
      if (words.some((word) => forbiddenWords.has(word))) continue;
      candidates.add(line.replace(/\s+/g, ' '));
    }
  }
  return [...candidates].slice(0, 8);
}

export function customerEmailCandidatesFromMessages(
  messages: CancellationRequestMessage[],
): string[] {
  const candidates = new Set<string>();
  for (const message of messages) {
    if (message.is_internal_note || message.sender_type !== 'customer') continue;
    const authored = authoredCustomerText(message.content);
    for (const email of authored.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) ?? []) {
      candidates.add(email.trim().toLowerCase());
    }
  }
  return [...candidates].slice(0, 8);
}

export function resolveVerifiedOrderTarget<T extends { id: string; name: string }>(
  orderId: unknown,
  orderName: unknown,
  orders: T[],
): T | null {
  const rawId = String(orderId ?? '').trim();
  const exactId = orders.find((order) => order.id === rawId);
  if (exactId) return exactId;

  const normalizeName = (value: unknown): string | null => {
    const raw = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
    if (!raw || raw.startsWith('gid://')) return null;
    return `#${raw.replace(/^#+/, '')}`;
  };
  const references = new Set(
    [normalizeName(orderId), normalizeName(orderName)]
      .filter((value): value is string => value !== null),
  );
  if (references.size === 0) return null;
  const matches = orders.filter((order) => (
    references.has(normalizeName(order.name) ?? '')
  ));
  return matches.length === 1 ? matches[0] : null;
}

function normalizeIdentityName(value: string | null | undefined): string | null {
  const credentialSuffixes = new Set([
    'rn', 'lpn', 'np', 'md', 'do', 'dds', 'dmd', 'phd', 'esq', 'cpa',
    'jr', 'sr', 'ii', 'iii', 'iv',
  ]);
  let raw = String(value ?? '').trim();
  const commaParts = raw.split(',').map((part) => part.trim());
  if (commaParts.length === 2 && commaParts.every(Boolean)
      && !credentialSuffixes.has(commaParts[1].toLowerCase().replace(/\./g, ''))) {
    raw = `${commaParts[1]} ${commaParts[0]}`;
  }
  const parts = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (parts.length > 2 && credentialSuffixes.has(parts.at(-1)!)) parts.pop();
  const normalized = parts.join(' ');
  return parts.length >= 2 ? normalized : null;
}

function normalizeIdentityPhone(value: string | null | undefined): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export function verifiedExplicitOrderIdentityEvidence(input: {
  ticketName?: string | null;
  ticketEmail?: string | null;
  ticketPhone?: string | null;
  messages: CancellationRequestMessage[];
  liveCustomerEmail?: string;
  liveCustomerPhone?: string;
  liveCustomerName?: string;
  liveShippingPhone?: string | null;
  liveShippingFirstName?: string | null;
  liveShippingLastName?: string | null;
}): string[] {
  const customerTexts = input.messages
    .filter((message) => message.sender_type === 'customer' && !message.is_internal_note)
    .map((message) => authoredCustomerText(message.content));
  const claimedNames = [
    input.ticketName,
    ...customerNameCandidatesFromMessages(input.messages),
  ]
    .map(normalizeIdentityName)
    .filter((value): value is string => value !== null);
  const claimedEmails = new Set(
    [
      input.ticketEmail,
      ...customerTexts.flatMap((text) => (
        text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi) ?? []
      )),
    ]
      .map((value) => String(value ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
  const claimedPhones = new Set(
    [
      input.ticketPhone,
      ...customerTexts.flatMap((text) => (
        text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g) ?? []
      )),
    ]
      .map(normalizeIdentityPhone)
      .filter((value): value is string => value !== null),
  );
  const liveNames = [
    input.liveCustomerName,
    [input.liveShippingFirstName, input.liveShippingLastName].filter(Boolean).join(' '),
  ]
    .map(normalizeIdentityName)
    .filter((value): value is string => value !== null);
  const evidence: string[] = [];
  if (
    input.liveCustomerEmail
    && claimedEmails.has(input.liveCustomerEmail.trim().toLowerCase())
  ) {
    evidence.push('customer_email');
  }
  for (const phone of [input.liveCustomerPhone, input.liveShippingPhone]) {
    const normalized = normalizeIdentityPhone(phone);
    if (normalized && claimedPhones.has(normalized)) {
      evidence.push('customer_phone');
      break;
    }
  }
  if (claimedNames.some((name) => liveNames.includes(name))) {
    evidence.push('customer_name');
  } else {
    const claimedLastNames = new Set(claimedNames.map((name) => name.split(' ').at(-1)));
    const lastNameMatches = liveNames.some((name) => (
      claimedLastNames.has(name.split(' ').at(-1))
    ));
    if (lastNameMatches) evidence.push('customer_last_name');
  }
  return [...new Set(evidence)];
}

function referencedKnownOrderIds(text: string, orders: CancellationRequestOrder[]): string[] {
  const references = orderReferenceTokens(text);
  return orders
    .filter((order) => references.has(order.name.toLowerCase().replace(/\s+/g, '')))
    .map((order) => order.id);
}

function clearReferencedOrOnly(
  authorized: Set<string>,
  text: string,
  orders: CancellationRequestOrder[],
): void {
  const referenced = referencedKnownOrderIds(authoredCustomerText(text), orders);
  if (referenced.length > 0) {
    for (const orderId of referenced) authorized.delete(orderId);
  } else if (authorized.size === 1) {
    authorized.clear();
  }
}

function orderIdsForExplicitRequest(
  text: string,
  eligible: CancellationRequestOrder[],
): string[] {
  const references = orderReferenceTokens(text);
  const referenced = eligible.filter((order) => (
    references.has(order.name.toLowerCase().replace(/\s+/g, ''))
  ));
  // An explicit but stale/unknown reference must never silently fall back to
  // another order merely because only one live order remains.
  if (references.size > 0) return referenced.map((order) => order.id);
  if (eligible.length === 1) return [eligible[0].id];

  const byUniqueItem = eligible.filter((order) => (order.lineItems ?? []).some((item) => {
    const title = item.title.trim().toLowerCase();
    return title.length >= 4 && text.includes(title);
  }));
  return byUniqueItem.length === 1 ? [byUniqueItem[0].id] : [];
}

export function revokesCancellationRequest(customerText: string): boolean {
  const text = authoredCustomerText(customerText);
  return [
    /\b(?:do\s+not|don't|dont|no\s+longer)\s+(?:want\s+(?:you\s+)?to\s+)?cancel\b/i,
    /\b(?:never\s*mind|nevermind)\b/i,
    /\bi(?:'ve|\s+have)?\s+changed\s+my\s+mind\b/i,
    /\b(?:keep|leave)\s+(?:(?:my|the|this|that)\s+)?order\b/i,
    /\b(?:do\s+not|don't|dont)\s+(?:do|process)\s+(?:it|that|the\s+cancellation)?[^.!?\n]{0,24}\byet\b/i,
    /\b(?:not\s+yet|hold\s+off(?:\s+on\s+(?:it|the\s+cancellation))?|wait\s+(?:to|before|until)\s+cancel(?:l)?ing)\b/i,
    /\b(?:proceed(?:ed|ing)?|continue|go\s+ahead)\s+with\s+(?:(?:my|the|this)\s+)?order\b/i,
  ].some((pattern) => pattern.test(text));
}

function defersOrConditionsCancellation(customerText: string): boolean {
  const text = authoredCustomerText(customerText);
  return [
    /\bcancel\b[^.!?\n]{0,120}\b(?:if|unless|provided\s+that|as\s+long\s+as)\b/i,
    /\b(?:if|unless|provided\s+that|as\s+long\s+as)\b[^.!?\n]{0,120}\bcancel\b/i,
    /\bcancel\b[^.!?\n]{0,120}\b(?:not\s+yet|hold\s+off|wait\s+(?:to|before|until))\b/i,
    /\bcancel\b[^.!?\n]{0,120}\b(?:do\s+not|don't|dont)\s+(?:do|process)\s+(?:it|that|the\s+cancellation)?[^.!?\n]{0,24}\byet\b/i,
    /\b(?:eta|estimate|timeline|status|progress|when\s+(?:it|the\s+order|my\s+order)[^.!?\n]{0,30}(?:arrive|ship|come))\b[^.!?\n]{0,120}\b(?:or|otherwise)\b[^.!?\n]{0,80}\bcancel\b/i,
  ].some((pattern) => pattern.test(text));
}

export function authorizedCancellationOrderIdsFromMessages(
  messages: CancellationRequestMessage[],
  orders: CancellationRequestOrder[],
): string[] {
  const authorized = new Set<string>();
  for (const message of messages) {
    if (message.is_internal_note) continue;
    if (message.sender_type === 'agent') {
      const deliveryStatus = typeof message.metadata?.email_status === 'string'
        ? message.metadata.email_status.toLowerCase()
        : null;
      const delivered = deliveryStatus === null || deliveryStatus === 'sent' || deliveryStatus === 'delivered';
      const terminalDisposition = [
        /\b(?:i|we)(?:'ve| have)?\s+(?:successfully\s+)?cancel(?:l)?ed\b/i,
        /\b(?:order(?:\s+#?[a-z0-9_-]+)?|cancellation)\s+(?:has|have|was|is)\s+(?:now\s+|been\s+)?cancel(?:l)?ed\b/i,
        /\bcancellation\s+(?:is\s+)?(?:complete|confirmed|done|all\s+set)\b/i,
        /\b(?:cannot|can't|unable|declined|too\s+late|not\s+possible)\b[^.!?\n]{0,80}\bcancel\b/i,
      ].some((pattern) => pattern.test(message.content));
      if (delivered && terminalDisposition) clearReferencedOrOnly(authorized, message.content, orders);
      continue;
    }
    if (message.sender_type !== 'customer') continue;
    const authoredText = message.content.slice(0, 24_000);
    const newlyAuthorized = explicitCancellationOrderIds(authoredText, orders);
    const fullRefundCancellationIds = wholeOrderRefundDemand(authoredText)
      ? orderIdsForExplicitRequest(
          authoredCustomerText(authoredText),
          orders.filter((order) => !order.cancelledAt),
        )
      : [];
    if (revokesCancellationRequest(authoredText) || defersOrConditionsCancellation(authoredText)) {
      const revoked = referencedKnownOrderIds(authoredCustomerText(authoredText), orders);
      if (revoked.length > 0) for (const orderId of revoked) authorized.delete(orderId);
      else authorized.clear();
    }
    if (newlyAuthorized.length > 0 && /\b(?:instead|rather)\b/i.test(authoredCustomerText(authoredText))) {
      authorized.clear();
    }
    for (const orderId of newlyAuthorized) authorized.add(orderId);
    // An urgent demand for a full order refund is also an instruction not to
    // fulfill that order. For an active order, cancellation is the Shopify
    // operation that prevents shipment and returns the paid balance.
    for (const orderId of fullRefundCancellationIds) authorized.add(orderId);
  }
  return [...authorized];
}

/** Conservative intent gate for irreversible cancellation actions. */
export function explicitCancellationOrderIds(
  customerText: string,
  orders: CancellationRequestOrder[],
): string[] {
  // Ignore common quoted/forwarded history. Only words authored by the
  // customer in this message can authorize an irreversible mutation.
  const text = authoredCustomerText(customerText);
  const explicitRequest = (
    /\bplease\s+cancel\b/i.test(text)
    || /(?:^|[.!?,;]\s*|\bactually[,:]?\s+)cancel\s+(?:(?:my|the|this)\s+)?(?:order\b|#\s*[a-z0-9])/i.test(text)
    || /\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:go\s+ahead\s+and\s+)?cancel\b/i.test(text)
    || /\b(?:can|could|would)\s+you\s+(?:please\s+)?issue\s+(?:me\s+)?a\s+refund\s+and\s+cancel\s+my\s+order\b/i.test(text)
    || /\bare\s+you\s+able\s+to\s+cancel\b/i.test(text)
    || /\bwould\s+it\s+be\s+possible\s+for\s+you\s+to\s+cancel\b/i.test(text)
    || /\bi\s+(?:want|need|would\s+like)\s+(?:you\s+)?to\s+(?:go\s+ahead\s+and\s+)?cancel\b/i.test(text)
    || /\bi(?:'d|\s+would)\s+like\s+(?:you\s+)?to\s+(?:go\s+ahead\s+and\s+)?cancel\b/i.test(text)
    || (/\bi(?:'d|\s+would)\s+like\s+to\s+proceed\s+with\s+cancell?ing\s+(?:(?:my|the|this)\s+)?order\b/i.test(text)
      && !/\b(?:if|unless)\b/i.test(text))
    || /\bi(?:'d|\s+would)\s+rather\s+(?:to\s+)?cancel\b/i.test(text)
    || /\blet(?:'s|\s+us)\s+(?:go\s+ahead\s+and\s+)?cancel\b/i.test(text)
    || /\bi\s+(?:want|need|would\s+(?:just\s+)?like)\s+(?:(?:my|the|this)\s+)?order\s+(?:to\s+be\s+)?cancel(?:l)?ed\b/i.test(text)
    || /\bi\s+(?:will|am\s+going\s+to)\s+need\s+to\s+be\s+cancell?ing\s+(?:(?:my|the|this)\s+)?order\b/i.test(text)
    // If Shopify still shows the order active, a customer's assertion that
    // they "already cancelled" it is also clear authorization to make that
    // requested terminal state real. Live execution remains idempotent.
    || /\bi(?:'ve|\s+have)\s+(?:already\s+)?cancel(?:l)?ed\s+(?:(?:my|the|this)\s+)?order\b/i.test(text)
  );
  const informationalOnly = /\b(?:tell|explain|confirm|check|know|whether|how)\b[^.!?\n]{0,100}\bcancel\b/i.test(text);
  const conditionalOnly = defersOrConditionsCancellation(text);
  const nonOrderDomain = /\bcancel\s+(?:(?:my|the|this|a)\s+)?(?:subscription|membership|return|refund(?:\s+request)?|replacement|exchange|warranty|appointment|service|plan|claim|shipment|delivery|address\s+(?:change|update))\b/i.test(text);
  const partialOrderTarget = /\bcancel\s+(?:(?:one|two|three|four|five|\d+|an?|the)\s+)?[^.!?\n]{1,80}\s+(?:from|off)\s+(?:(?:my|the|this)\s+)?order\b/i.test(text);
  const negated = revokesCancellationRequest(text);
  if (!explicitRequest || informationalOnly || conditionalOnly || nonOrderDomain || partialOrderTarget || negated) return [];

  const eligible = orders.filter((order) => !order.cancelledAt);
  const references = orderReferenceTokens(text);
  // Whole-order cancellation must name the order domain (or an exact order
  // reference). A product/item mention can never silently authorize cancelling
  // the entire order.
  if (!/\border\b/i.test(text) && references.size === 0) return [];
  return orderIdsForExplicitRequest(text, eligible);
}

function revokesRefundRequest(text: string): boolean {
  const authored = authoredCustomerText(text);
  return /\b(?:do\s+not|don't|dont|no\s+longer)\s+(?:want\s+)?(?:a\s+)?refund\b/i.test(authored)
    || /\b(?:never\s*mind|nevermind)\b/i.test(authored)
    || /\bi(?:'ve|\s+have)?\s+changed\s+my\s+mind\b/i.test(authored)
    || /\b(?:keep|leave)\s+(?:(?:my|the|this|that)\s+)?order\b/i.test(authored);
}

function coordinatedCancellationRefundRequest(
  text: string,
  orders: CancellationRequestOrder[],
): boolean {
  const authored = authoredCustomerText(text);
  return explicitCancellationOrderIds(authored, orders).length > 0
    && !revokesCancellationRequest(authored)
    && !revokesRefundRequest(authored)
    && /\bcancel\b[^.!?\n]{0,100}\band\s+(?:receive|get)\s+(?:a|the|my)\s+(?:full\s+)?refund\b/i.test(authored);
}

function urgentWholeOrderRefundDemand(text: string): boolean {
  const authored = authoredCustomerText(text);
  return /\bfull\s+refund\b[^.!?\n]{0,40}\b(?:asap|today|immediately|right\s+now|now)\b/i.test(authored)
    || /\b(?:need|want|demand|request(?:ing)?|get|receive)\b[^.!?\n]{0,80}\bfull\s+refund\b/i.test(authored);
}

function wholeOrderRefundDemand(text: string): boolean {
  const authored = authoredCustomerText(text);
  const directWholeOrderRequest = (
    /\b(?:please\s+)?refund\s+(?:my|the|this)\s+order\b/i.test(authored)
    || /\bi(?:'d|\s+would)\s+like\s+(?:a|the|my)\s+(?:full\s+)?refund\b/i.test(authored)
  );
  const conditional = /\b(?:if|unless|otherwise|in\s+case)\b[^.!?\n]{0,120}\brefund\b|\brefund\b[^.!?\n]{0,120}\b(?:if|unless)\b/i
    .test(authored);
  return urgentWholeOrderRefundDemand(authored) || (directWholeOrderRequest && !conditional);
}

export function explicitRefundOrderIds(
  customerText: string,
  orders: CancellationRequestOrder[],
): string[] {
  const text = authoredCustomerText(customerText);
  const coordinatedCancellationRefund = coordinatedCancellationRefundRequest(text, orders);
  const explicitRequest = (
    /\bplease\s+(?:(?:issue|process|send)\s+)?(?:me\s+)?(?:a\s+)?(?:full\s+)?refund\b/i.test(text)
    || /\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:(?:issue|process|send)\s+)?(?:me\s+)?(?:a\s+)?(?:full\s+)?refund\b/i.test(text)
    || /\bi\s+(?:want|need|would\s+like)\s+(?:a|the|my)\s+(?:full\s+)?refund\b/i.test(text)
    || /\bi(?:'d|\s+would)\s+like\s+(?:a|the|my)\s+(?:full\s+)?refund\b/i.test(text)
    || /\bi\s+need\b[^.!?\n]{0,80}\babout\s+(?:a\s+)?(?:full\s+)?refund\b/i.test(text)
    || /(?:^|[.!?,;]\s*|\bactually[,:]?\s+)(?:refund|reimburse)\s+(?:me|my|the|this)\b/i.test(text)
    || /\b(?:my|the|this)?\s*(?:payment|order)\s+(?:to\s+be\s+)?refunded\s+in\s+full\b/i.test(text)
    || coordinatedCancellationRefund
    || urgentWholeOrderRefundDemand(text)
  );
  const informationalOnly = /\b(?:when|where|status|track|tracking|policy|eligible|eligibility|whether|how\s+long)\b[^.!?\n]{0,100}\brefund\b|\b(?:will|would|can|could)\s+i\s+(?:get|receive)\s+(?:a\s+)?refund\b/i.test(text);
  const conditionalOnly = (
    /\brefund\b[^.!?\n]{0,100}\bif\b|\bif\b[^.!?\n]{0,100}\brefund\b/i.test(text)
    && !urgentWholeOrderRefundDemand(text)
  );
  if (!explicitRequest || informationalOnly || conditionalOnly || revokesRefundRequest(text)) return [];
  return orderIdsForExplicitRequest(text, orders);
}

export function authorizedRefundOrderIdsFromMessages(
  messages: CancellationRequestMessage[],
  orders: CancellationRequestOrder[],
): string[] {
  return [...authorizedRefundAmountByOrderFromMessages(messages, orders).keys()];
}

/** Null means the customer authorized a refund but did not quote one amount. */
export function authorizedRefundAmountByOrderFromMessages(
  messages: CancellationRequestMessage[],
  orders: CancellationRequestOrder[],
): Map<string, number | null> {
  const authorized = new Map<string, number | null>();
  for (const message of messages) {
    if (message.is_internal_note) continue;
    if (message.sender_type === 'agent') {
      const status = typeof message.metadata?.email_status === 'string'
        ? message.metadata.email_status.toLowerCase()
        : null;
      const delivered = status === null || status === 'sent' || status === 'delivered';
      const terminal = /\brefund\b[^.!?\n]{0,80}\b(?:was|is|has\s+been)\s+(?:issued|processed|completed|declined)|\b(?:cannot|can't|unable|declined)\b[^.!?\n]{0,80}\brefund\b/i
        .test(message.content);
      if (delivered && terminal) {
        const referenced = referencedKnownOrderIds(authoredCustomerText(message.content), orders);
        if (referenced.length > 0) for (const orderId of referenced) authorized.delete(orderId);
        else if (authorized.size === 1) authorized.clear();
      }
      continue;
    }
    if (message.sender_type !== 'customer') continue;
    const text = message.content.slice(0, 24_000);
    const newlyAuthorized = explicitRefundOrderIds(text, orders);
    if (revokesRefundRequest(text)) {
      const revoked = referencedKnownOrderIds(authoredCustomerText(text), orders);
      if (revoked.length > 0) for (const orderId of revoked) authorized.delete(orderId);
      else authorized.clear();
    }
    if (newlyAuthorized.length > 0 && /\b(?:instead|rather)\b/i.test(authoredCustomerText(text))) {
      authorized.clear();
    }
    const customerText = authoredCustomerText(text);
    // A customer following up on a promised refund is not making a new,
    // ambiguous purchase request. If the live order is already cancelled but
    // still has a paid balance, the latest "where is my refund?" message is
    // authorization to finish that exact outstanding refund. This repairs the
    // common partial-success state where cancellation committed but its refund
    // did not, even if an earlier agent email incorrectly said both completed.
    const missingExpectedRefund = [
      /\b(?:still|yet|never|not|hasn't|has\s+not|haven't|have\s+not)\b[^.!?\n]{0,100}\b(?:received|gotten|seen|see|showing|posted)\b[^.!?\n]{0,60}\brefund\b/i,
      /\brefund\b[^.!?\n]{0,100}\b(?:still|yet|never|not|hasn't|has\s+not|haven't|have\s+not|missing)\b/i,
      /\b(?:where|status|update|confirm)\b[^.!?\n]{0,80}\brefund\b/i,
      /\brefund\b[^.!?\n]{0,80}\b(?:initiated|processed|completed)\b/i,
    ].some((pattern) => pattern.test(customerText));
    if (missingExpectedRefund) {
      const referenced = referencedKnownOrderIds(customerText, orders);
      const candidates = orders.filter((order) => {
        const status = String(order.financialStatus ?? '').toUpperCase();
        const total = Number.parseFloat(String(order.totalPrice ?? 0));
        const refunded = Number.parseFloat(String(order.totalRefunded ?? 0));
        return Boolean(order.cancelledAt)
          && status !== 'REFUNDED'
          && Number.isFinite(total)
          && total > 0
          && Number.isFinite(refunded)
          && refunded < total - 0.01;
      });
      const targets = referenced.length > 0
        ? candidates.filter((order) => referenced.includes(order.id))
        : candidates.length === 1 ? candidates : [];
      for (const order of targets) {
        const remaining = Number.parseFloat(String(order.totalPrice))
          - Number.parseFloat(String(order.totalRefunded ?? 0));
        if (remaining > 0.01) authorized.set(order.id, Number(remaining.toFixed(2)));
      }
    }
    const amounts = claimedCurrencyAmounts(customerText);
    if (amounts.length > 1) continue;
    const unambiguousWholeOrderRefund = (
      /\bfull\s+refund\b/i.test(customerText)
      || /\b(?:payment|order)\s+(?:to\s+be\s+)?refunded\s+in\s+full\b/i.test(customerText)
      || /\brefund\b[^.!?\n]{0,40}\b(?:entire|whole)\s+order\b/i.test(customerText)
      || /\brefund\s+(?:(?:me|us)\s+)?(?:for\s+)?(?:(?:the|my|this)\s+)?order\b/i.test(customerText)
      || coordinatedCancellationRefundRequest(customerText, orders)
    );
    // A null amount would let the executor refund the entire remaining
    // balance. Only permit that when the customer explicitly scopes the
    // request to the whole order. Named/described items, quantities,
    // fractions, fees, and every other unpriced partial scope stay review-only.
    if (amounts.length === 0 && !unambiguousWholeOrderRefund) continue;
    for (const orderId of newlyAuthorized) authorized.set(orderId, amounts[0] ?? null);
  }
  return authorized;
}

function revokesAddressRequest(text: string): boolean {
  return /\b(?:do\s+not|don't|dont|no\s+longer)\s+(?:change|update|correct|edit)\b[^.!?\n]{0,60}\baddress\b/i
    .test(authoredCustomerText(text));
}

function explicitAddressUpdateOrderIds(
  customerText: string,
  orders: CancellationRequestOrder[],
): string[] {
  const text = authoredCustomerText(customerText);
  const customerChangeQuestionWithDestination = (
    /\b(?:can|could|would)\s+i\s+(?:please\s+)?(?:change|update|correct|edit)\b[^.!?\n]{0,60}\b(?:(?:the|my)\s+)?(?:ship(?:ping)?\s+to\s+|shipping\s+|delivery\s+)?address\b/i.test(text)
    && (
      /\bi(?:'ve|\s+have)?\s+moved\s+to\b/i.test(text)
      || /\b(?:my\s+)?new\s+(?:shipping\s+|delivery\s+)?address\s+(?:is|:)\b/i.test(text)
    )
  );
  const explicitCorrection = (
    /\b(?:entered|typed|provided|gave|put)\b[^.!?]{0,90}\b(?:add?ress|apartment|apt|unit|suite|street|zip|postal(?:\s+code)?)\b[^.!?]{0,55}\b(?:wrong|incorrect(?:ly)?|mistake|typo)\b/i.test(text)
    || /\b(?:wrong|incorrect)\b[^.!?]{0,55}\b(?:shipping\s+|delivery\s+|billing\s+)?(?:add?ress|apartment|apt|unit|suite|street|zip|postal(?:\s+code)?)\b/i.test(text)
    || /\b(?:add?ress|apartment|apt|unit|suite|street|zip|postal(?:\s+code)?)\b[^.!?]{0,55}\b(?:is|was)?\s*(?:wrong|incorrect)\b/i.test(text)
    || /\b(?:the\s+)?correct(?:ed)?\s+(?:shipping\s+|delivery\s+|billing\s+)?add?ress\s+(?:is|:|for\b)\s*/i.test(text)
    || /\b(?:shipping\s+|delivery\s+)?add?ress\s+correction\b/i.test(text)
  );
  const suppliedReplacementDestination = (
    /\b(?:correct(?:ed)?|new|updated|replacement)\s+(?:shipping\s+|delivery\s+|billing\s+)?add?ress\s+(?:is|:|for\b)/i.test(text)
    || /\b(?:deliver|delivery|ship(?:ping)?)\b[^.!?\n]{0,45}\b(?:instead|correct|updated|new)\b/i.test(text)
    || /\b(?:before|prior\s+to)\b[^.!?\n]{0,45}\b(?:ship|ships|shipped|fulfill|fulfillment)\b/i.test(text)
  );
  const explicitRequest = (
    /\bplease\s+(?:change|update|correct|edit)\b[^.!?\n]{0,60}\b(?:shipping\s+|delivery\s+)?address\b/i.test(text)
    || /\b(?:can|could|would)\s+you\s+(?:please\s+)?(?:change|update|correct|edit)\b[^.!?\n]{0,60}\b(?:shipping\s+|delivery\s+)?address\b/i.test(text)
    || /\bi\s+(?:want|need|would\s+like)\s+(?:you\s+)?to\s+(?:change|update|correct|edit)\b[^.!?\n]{0,60}\baddress\b/i.test(text)
    || customerChangeQuestionWithDestination
    || (explicitCorrection && suppliedReplacementDestination)
    || /\b(?:can|could|would)\s+(?:(?:my|the|this)\s+)?order\s+(?:please\s+)?be\s+(?:shipped|sent|delivered)\s+to\s+(?:(?:the|a)\s+)?(?:following|new|different|updated)\s+(?:shipping\s+|delivery\s+)?address\b/i.test(text)
    || /\bplease\s+(?:ship|send|deliver)\s+(?:(?:my|the)\s+)?order\s+to\b/i.test(text)
    || /(?:^|[.!?,;]\s*|\bactually[,:]?\s+)(?:ship|send|deliver)\s+(?:it|the\s+order|my\s+order)\s+to\b/i.test(text)
  );
  const conditionalOnly = (
    /\b(?:change|update|correct|edit)\b[^.!?\n]{0,100}\b(?:if|unless)\b|\b(?:if|unless)\b[^.!?\n]{0,100}\b(?:change|update|correct|edit)\b/i.test(text)
    || /\b(?:ship|send|deliver|shipped|sent|delivered)\b[^.!?\n]{0,100}\b(?:if|unless)\b|\b(?:if|unless)\b[^.!?\n]{0,100}\b(?:ship|send|deliver|shipped|sent|delivered)\b/i.test(text)
  );
  if (!explicitRequest || conditionalOnly || revokesAddressRequest(text)) return [];
  return orderIdsForExplicitRequest(text, orders.filter((order) => !order.cancelledAt));
}

/** Customer-authored text that may authorize exact, verbatim address fields. */
export function authorizedShippingAddressTextByOrder(
  messages: CancellationRequestMessage[],
  orders: CancellationRequestOrder[],
): Map<string, string> {
  const authorized = new Map<string, string>();
  for (const message of messages) {
    if (message.is_internal_note) continue;
    if (message.sender_type === 'agent') {
      const status = typeof message.metadata?.email_status === 'string'
        ? message.metadata.email_status.toLowerCase()
        : null;
      const delivered = status === null || status === 'sent' || status === 'delivered';
      const terminal = /\b(?:shipping\s+)?address\s+(?:was|is|has\s+been)\s+(?:updated|changed)|\b(?:i|we)(?:'ve|\s+have)?\s+(?:now\s+)?(?:updated|changed|corrected)\b[^.!?\n]{0,80}\b(?:shipping|delivery)?\s*address\b|\b(?:cannot|can't|unable)\b[^.!?\n]{0,80}\b(?:change|update)\b[^.!?\n]{0,40}\baddress\b/i
        .test(message.content);
      if (delivered && terminal) {
        const referenced = referencedKnownOrderIds(authoredCustomerText(message.content), orders);
        if (referenced.length > 0) for (const orderId of referenced) authorized.delete(orderId);
        else if (authorized.size === 1) authorized.clear();
      }
      continue;
    }
    if (message.sender_type !== 'customer') continue;
    const text = message.content.slice(0, 24_000);
    const orderIds = explicitAddressUpdateOrderIds(text, orders);
    if (revokesAddressRequest(text)) {
      const revoked = referencedKnownOrderIds(authoredCustomerText(text), orders);
      if (revoked.length > 0) for (const orderId of revoked) authorized.delete(orderId);
      else authorized.clear();
    }
    if (orderIds.length > 0 && /\b(?:instead|rather)\b/i.test(authoredCustomerText(text))) {
      authorized.clear();
    }
    for (const orderId of orderIds) {
      authorized.set(orderId, authoredCustomerTextPreservingCase(text));
    }
  }
  return authorized;
}

export function addressValueAppearsInAuthorizedText(value: unknown, authorizedText: string): boolean {
  const normalize = (input: string) => input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const needle = normalize(String(value ?? ''));
  return needle.length > 0 && ` ${normalize(authorizedText)} `.includes(` ${needle} `);
}

export type CanonicalShippingAddressUpdate =
  Record<'address1' | 'city' | 'province' | 'zip', string>
  & Partial<Record<'address2' | 'country', string>>;

export type CanonicalShippingAddressUpdateResult =
  | { ok: true; address: CanonicalShippingAddressUpdate }
  | { ok: false; error: string };

const US_STATE_OR_TERRITORY =
  '(?:A[KLRZ]|C[AOT]|D[EC]|F[LM]|G[AU]|HI|I[ADLN]|K[SY]|LA|M[ADEHINOST]|N[CDEHJMVY]|O[HKR]|P[ARW]|RI|S[CD]|T[NX]|UT|V[AIT]|W[AIVY])';

function cleanedAddressLine(line: string): string {
  return line
    .trim()
    .replace(/^[*>\-\u2022]+\s*/, '')
    .replace(/[.;]+$/, '')
    .trim();
}

function splitStreetAndUnit(street: string): { address1: string; address2?: string } {
  const trimmed = street.trim().replace(/,\s*$/, '');
  const unit = trimmed.match(
    /^(.*?)(?:,\s*|\s+)((?:apt|apartment|unit|suite|ste|floor|fl)\.?\s*#?\s*[a-z0-9-]+|#\s*[a-z0-9-]+)$/i,
  );
  if (!unit) return { address1: trimmed };
  return {
    address1: unit[1].trim(),
    address2: unit[2].trim(),
  };
}

/**
 * Deterministically recover a common US shipping address from the exact
 * customer-authored authorization. This is a resilience path for planner
 * outages/invalid structured output, not a substitute for authorization:
 * every returned field is still copied verbatim from the customer's text.
 */
export function extractAuthorizedShippingAddressUpdate(
  authorizedText: string,
): CanonicalShippingAddressUpdateResult {
  const lines = authorizedText
    .split(/\r?\n/)
    .map(cleanedAddressLine)
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const singleLine = line.match(
      new RegExp(`^(.+?),\\s*([^,]+),\\s*(${US_STATE_OR_TERRITORY})\\s+(\\d{5}(?:-\\d{4})?)$`, 'i'),
    );
    if (singleLine) {
      const street = splitStreetAndUnit(singleLine[1]);
      const candidate = canonicalizeAuthorizedShippingAddressUpdate({
        ...street,
        city: singleLine[2].trim(),
        province: singleLine[3].trim(),
        zip: singleLine[4].trim(),
      }, authorizedText);
      if (candidate.ok) return candidate;
    }

    const cityStateZip = line.match(
      new RegExp(`^(.+?)(?:,\\s*|\\s+)(${US_STATE_OR_TERRITORY})\\s+(\\d{5}(?:-\\d{4})?)$`, 'i'),
    );
    if (!cityStateZip) continue;

    const previous = lines.slice(Math.max(0, index - 4), index);
    const address1Index = previous.findIndex((candidate) => (
      /^(?:\d{1,8}\s+\S|P\.?\s*O\.?\s+Box\s+\S)/i.test(candidate)
    ));
    if (address1Index < 0) continue;
    const address1Line = previous[address1Index];
    const possibleAddress2 = previous[address1Index + 1];
    const street = splitStreetAndUnit(address1Line);
    const address2 = street.address2
      ?? (
        possibleAddress2
        && /^(?:apt|apartment|unit|suite|ste|floor|fl)\.?\s*#?\s*[a-z0-9-]+$/i.test(possibleAddress2)
          ? possibleAddress2
          : undefined
      );
    const candidate = canonicalizeAuthorizedShippingAddressUpdate({
      address1: street.address1,
      ...(address2 ? { address2 } : {}),
      city: cityStateZip[1].trim(),
      province: cityStateZip[2].trim(),
      zip: cityStateZip[3].trim(),
    }, authorizedText);
    if (candidate.ok) return candidate;
  }

  return {
    ok: false,
    error: 'customer authorized an address correction, but a complete street, city, province, and postal code could not be parsed',
  };
}

/**
 * Keep the model inside the customer's exact address-change authorization.
 * The new delivery location must be complete enough to route, while recipient
 * identity, country, and phone may be omitted and preserved from the live
 * Shopify order immediately before execution.
 */
export function canonicalizeAuthorizedShippingAddressUpdate(
  value: unknown,
  authorizedText: string,
): CanonicalShippingAddressUpdateResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'address is missing' };
  }
  const input = value as Record<string, unknown>;
  const required = ['address1', 'city', 'province', 'zip'] as const;
  const address: Partial<CanonicalShippingAddressUpdate> = {};

  for (const field of required) {
    const candidate = String(input[field] ?? '').trim();
    if (!candidate) return { ok: false, error: `address is missing ${field}` };
    if (!addressValueAppearsInAuthorizedText(candidate, authorizedText)) {
      return { ok: false, error: `address field ${field} was not copied verbatim from the authorizing message` };
    }
    address[field] = candidate;
  }

  const exactOptional = ['address2'] as const;
  for (const field of exactOptional) {
    const candidate = String(input[field] ?? '').trim();
    if (!candidate) continue;
    if (!addressValueAppearsInAuthorizedText(candidate, authorizedText)) {
      return { ok: false, error: `address field ${field} was not copied verbatim from the authorizing message` };
    }
    address[field] = candidate;
  }

  const country = String(input.country ?? '').trim();
  if (country && addressValueAppearsInAuthorizedText(country, authorizedText)) {
    address.country = country;
  }

  return { ok: true, address: address as CanonicalShippingAddressUpdate };
}

/**
 * Shopify's display fulfillment status is evidence about operational risk, not
 * an authoritative `orderCancel` eligibility flag. Keep the action available
 * for human review while avoiding inventory creation when anything may already
 * have left the warehouse.
 */
export function cancellationPlanPolicy(input: {
  fulfillmentStatus: string | null | undefined;
  trackingCount: number;
}): CancellationPlanPolicy {
  const observedFulfillmentStatus = String(input.fulfillmentStatus || 'UNKNOWN').toUpperCase();
  const trackingPresent = input.trackingCount > 0;
  const clearlyUnfulfilled = observedFulfillmentStatus === 'UNFULFILLED' && !trackingPresent;

  if (clearlyUnfulfilled) {
    return {
      restock: true,
      confidenceCap: 0.9,
      observedFulfillmentStatus,
      trackingPresent,
      riskNote: null,
    };
  }

  const trackingDescription = trackingPresent ? 'tracking is present' : 'no tracking is present';
  return {
    restock: false,
    confidenceCap: trackingPresent ? 0.45 : 0.65,
    observedFulfillmentStatus,
    trackingPresent,
    riskNote: trackingPresent
      ? `Shopify reports ${observedFulfillmentStatus} and ${trackingDescription}. Autopilot will ask Shopify to cancel and refund without restocking; the reply stays blocked until live cancellation is confirmed.`
      : `Shopify reports ${observedFulfillmentStatus} and ${trackingDescription}. Autopilot will cancel the untracked outstanding fulfillment first, then cancel and refund the whole order without restocking; the reply stays blocked until live cancellation is confirmed.`,
  };
}

/**
 * A full refund of an unshipped order is a whole-order cancellation. Issuing
 * only a payment refund would leave the order open and eligible for later
 * fulfillment, which contradicts the customer's intent.
 */
export function wholeOrderRefundShouldCancel(input: {
  fulfillmentStatus: string | null | undefined;
  trackingCount: number;
  totalPrice: string | number | null | undefined;
  totalRefunded: string | number | null | undefined;
  requestedAmount: string | number | null | undefined;
}): boolean {
  const total = Number.parseFloat(String(input.totalPrice ?? ''));
  const alreadyRefunded = Number.parseFloat(String(input.totalRefunded ?? 0));
  const requested = Number.parseFloat(String(input.requestedAmount ?? ''));
  const outstanding = total - alreadyRefunded;
  // Customers routinely quote a rounded whole-order amount (for example
  // "$550" for a $550.50 balance). Treat a small, bounded rounding delta as
  // full-order intent so the order is cancelled instead of left fulfillable.
  const wholeOrderTolerance = Number.isFinite(outstanding)
    ? Math.min(5, Math.max(0.01, outstanding * 0.01))
    : 0;
  return String(input.fulfillmentStatus || '').toUpperCase() === 'UNFULFILLED'
    && input.trackingCount === 0
    && Number.isFinite(outstanding)
    && outstanding > 0
    && Number.isFinite(requested)
    && Math.abs(requested - outstanding) <= wholeOrderTolerance;
}

const COMPLETED_OUTCOME_PATTERNS: Record<AutopilotMutationOutcome, RegExp[]> = {
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
    /\b(?:your|the)?\s*refund\s+(?:is|was|has\s+been)\s+(?:complete|completed)\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+completed\s+(?:your|the|a)\s+refund\b/i,
    /\b(?:your|the)?\s*refund\s+(?:was|is)\s+successful\b/i,
    /\b(?:your|the)?\s*refund\s+succeeded\b/i,
    /\b(?:i|we)\s+took\s+care\s+of\s+(?:your|the|a)?\s*refund\b/i,
    /\b(?:your|the)?\s*refund\s+(?:is|was)\s+done\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+finalized\s+(?:your|the|a)\s+refund\b/i,
    /\brefund\b[^\n]{0,140}\bwill\s+be\s+(?:processed|issued|submitted|returned|credited)\b/i,
    /\b(?:i|we)(?:'ll|\s+will)\b[^\n]{0,180}\brefund\b/i,
    /\brefund\b[^\n]{0,120}\b(?:has\s+been|was|is)\s+(?:processed|issued|submitted|completed|successful)\b/i,
  ],
  update_shipping_address: [
    /\b(?:your\s+|the\s+)?(?:(?:shipping|delivery)\s+)?address\s+(?:update|change|correction)\s+(?:(?:is|was|has\s+been)\s+(?:done|complete|completed|confirmed|successful|finalized|processed|handled|finished|all\s+set|taken\s+care\s+of)|(?:has\s+)?succeeded|went\s+through|has\s+gone\s+through)\b/i,
    /\b(?:i|we)(?:'ve| have)?\s+(?:took\s+care\s+of|taken\s+care\s+of|completed|confirmed|finalized|processed|handled|finished)\s+(?:the\s+|your\s+)?(?:(?:shipping|delivery)\s+)?address\s+(?:update|change|correction)\b/i,
    /\b(?:we(?:'ve| have)\s+|(?:i|we)(?:'ve| have)?\s+)?(?:updated|changed|corrected)\s+(?:your|the)\s+(?:shipping\s+)?address\b/i,
    /\b(?:shipping\s+)?address\s+(?:has|have|was|is)\s+(?:now\s+|been\s+)?(?:updated|changed|corrected)\b/i,
    /\b(?:shipping\s+)?address(?:\s+change)?\s+(?:is\s+)?all\s+set\b/i,
    /\b(?:i|we)\s+took\s+care\s+of\s+(?:the\s+|your\s+)?(?:shipping\s+)?address(?:\s+change)?\b/i,
    /\b(?:your|the)?\s*(?:shipping\s+)?address\s+update\s+(?:was|is)\s+successful\b/i,
    /\b(?:your|the)?\s*(?:shipping\s+)?address\s+change\s+(?:was|is)\s+successful\b/i,
    /\b(?:your|the)?\s*(?:shipping\s+)?address\s+change\s+succeeded\b/i,
  ],
};

/**
 * Natural-language fallback for models that omit `requires_action_types`.
 * These patterns intentionally target completed outcomes, not questions,
 * inability statements, or a customer's request to perform an action.
 */
export function claimedCompletedMutationOutcomes(replyText: string): AutopilotMutationOutcome[] {
  return (Object.entries(COMPLETED_OUTCOME_PATTERNS) as Array<[
    AutopilotMutationOutcome,
    RegExp[],
  ]>)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(replyText)))
    .map(([outcome]) => outcome);
}

export function claimedCurrencyAmounts(replyText: string): number[] {
  const values = [...replyText.matchAll(/(?:[$£€]\s*|\b(?:usd|cad|aud|eur|gbp)\s+)(\d[\d,]*(?:\.\d{1,2})?)|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:dollars?|usd|cad|aud|eur|gbp)\b/gi)]
    .map((match) => Number((match[1] ?? match[2]).replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));
  return [...new Set(values)];
}

export function missingReplyOutcomeDependencies(input: {
  replyText: string;
  declaredRequiredOutcomes?: unknown;
  availableOutcomes: Iterable<string>;
  /** Observed live facts, not operations this plan will perform. */
  historicalOutcomes?: Iterable<string>;
}): AutopilotMutationOutcome[] {
  const available = new Set(input.availableOutcomes);
  const declared = Array.isArray(input.declaredRequiredOutcomes)
    ? input.declaredRequiredOutcomes.filter((value): value is AutopilotMutationOutcome => (
        typeof value === 'string'
        && Object.prototype.hasOwnProperty.call(COMPLETED_OUTCOME_PATTERNS, value)
      ))
    : [];
  const required = new Set<AutopilotMutationOutcome>([
    ...declared,
    ...claimedCompletedMutationOutcomes(input.replyText),
  ]);

  // Callers add refund_order only when live financial state says a cancellation
  // has a payment to refund. A cancellation alone must never imply money moved.
  for (const outcome of input.historicalOutcomes ?? []) available.add(outcome);

  return [...required].filter((outcome) => !available.has(outcome));
}

/** Exact refund amounts need a verified action only when completion is claimed. */
export function completedRefundAmountsRequiringAction(
  replyText: string,
  declaredRequiredOutcomes?: unknown,
): number[] {
  const completedOutcomes = missingReplyOutcomeDependencies({
    replyText,
    declaredRequiredOutcomes,
    availableOutcomes: [],
  });
  return completedOutcomes.includes('refund_order')
    ? claimedCurrencyAmounts(replyText)
    : [];
}
