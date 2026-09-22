import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addressValueAppearsInAuthorizedText,
  automaticSameCaseTicketIds,
  authorizedCancellationOrderIdsFromMessages,
  authorizedRefundOrderIdsFromMessages,
  authorizedRefundAmountByOrderFromMessages,
  authorizedShippingAddressTextByOrder,
  cancellationPlanPolicy,
  canonicalizeAuthorizedShippingAddressUpdate,
  canonicalizeReplyGreeting,
  claimedCurrencyAmounts,
  claimedCompletedMutationOutcomes,
  completedRefundAmountsRequiringAction,
  customerEmailCandidatesFromMessages,
  customerNameCandidatesFromMessages,
  explicitCancellationOrderIds,
  extractAuthorizedShippingAddressUpdate,
  missingReplyOutcomeDependencies,
  passesRelatedTicketCandidateGate,
  proactivelyOffersOrderCancellationOrRefund,
  customerRaisedCancellationOrRefund,
  authoredCustomerTextPreservingCase,
  referencedOrderNamesFromMessages,
  referencedOrderNamesFromText,
  resolveVerifiedOrderTarget,
  revokesCancellationRequest,
  verifiedExplicitOrderIdentityEvidence,
  wholeOrderRefundShouldCancel,
} from './autopilot-action-policy.js';

test('wrapped email quote headers cannot authorize actions or corrupt customer names', () => {
  const body = 'Thanks, I still want the lamp.\n\nOn Thu, September 10, 2026 at 3:59 PM Warm by Design <support@example.com>\nwrote:\nPlease cancel my order #1047.\nFree Standard Shipping';
  assert.equal(authoredCustomerTextPreservingCase(body), 'Thanks, I still want the lamp.');
  assert.deepEqual(explicitCancellationOrderIds(body, [{ id: 'one', name: '#1047' }]), []);
  assert.equal(customerRaisedCancellationOrRefund(body), false);
});

test('a coordinated polite refund-and-cancel request identifies its order', () => {
  const orders = [{ id: 'one', name: '#1047', cancelledAt: null }];
  assert.deepEqual(explicitCancellationOrderIds('Can you please issue me a refund and cancel my order?', orders), ['one']);
  assert.deepEqual(explicitCancellationOrderIds('Can you please issue me a refund and cancel my order if it cannot ship?', orders), []);
});

test('an explicit proceed-with-cancelling request persists through a status-only response', () => {
  const orders = [{ id: 'one', name: '#1165', cancelledAt: null }];
  const request = "I'd like to proceed with canceling my order. Please confirm when the cancellation is processed.";
  assert.deepEqual(explicitCancellationOrderIds(request, orders), ['one']);
  assert.deepEqual(authorizedCancellationOrderIdsFromMessages([
    { sender_type: 'customer', content: request },
    { sender_type: 'agent', content: 'Order #1165 has not shipped yet.' },
    { sender_type: 'customer', content: 'Update?' },
  ], orders), ['one']);
  assert.deepEqual(explicitCancellationOrderIds("I'd like to proceed with cancelling my order if it cannot arrive tomorrow.", orders), []);
  assert.deepEqual(explicitCancellationOrderIds("I would not like to proceed with cancelling my order.", orders), []);
});
test('cancellation questions can be answered without authorizing a cancellation', () => {
  const orders = [{ id: 'one', name: '#1165', cancelledAt: null }];
  const question = 'Is it possible to cancel and get a refund?';
  assert.equal(customerRaisedCancellationOrRefund(question), true);
  assert.deepEqual(explicitCancellationOrderIds(question, orders), []);
  assert.equal(customerRaisedCancellationOrRefund('Where is my order?'), false);
  assert.equal(customerRaisedCancellationOrRefund('Please keep my order; do not cancel it.'), false);
  assert.equal(customerRaisedCancellationOrRefund('Any update?\nOn Monday Support wrote:\nYou can cancel and get a refund.'), false);
});

test('a full refund on an unfulfilled untracked order becomes cancellation', () => {
  assert.equal(wholeOrderRefundShouldCancel({
    fulfillmentStatus: 'UNFULFILLED',
    trackingCount: 0,
    totalPrice: '562.50',
    totalRefunded: 0,
    requestedAmount: 562.5,
  }), true);
  assert.equal(wholeOrderRefundShouldCancel({
    fulfillmentStatus: 'FULFILLED',
    trackingCount: 1,
    totalPrice: '562.50',
    totalRefunded: 0,
    requestedAmount: 562.5,
  }), false);
  assert.equal(wholeOrderRefundShouldCancel({
    fulfillmentStatus: 'UNFULFILLED',
    trackingCount: 0,
    totalPrice: '550.50',
    totalRefunded: 0,
    requestedAmount: 550,
  }), true);
  assert.equal(wholeOrderRefundShouldCancel({
    fulfillmentStatus: 'UNFULFILLED',
    trackingCount: 0,
    totalPrice: '562.50',
    totalRefunded: 0,
    requestedAmount: 100,
  }), false);
});

test('automatic consolidation selects only strong same-case signals', () => {
  assert.deepEqual(automaticSameCaseTicketIds([
    { ticket_id: 'same-subject', relation_reason: 'same subject, within 14 days' },
    { ticket_id: 'same-order-topic', relation_reason: 'same order reference, same topic signal' },
    { ticket_id: 'same-chat', relation_reason: 'same chat escalation' },
    { ticket_id: 'order-only', relation_reason: 'same order reference, within 14 days' },
    { ticket_id: 'topic-only', relation_reason: 'same topic signal, within 14 days' },
  ]), ['same-subject', 'same-order-topic', 'same-chat']);
});

test('automatic consolidation selects near-simultaneous same-intent and same-topic follow-ups', () => {
  assert.deepEqual(automaticSameCaseTicketIds([{
    ticket_id: 'duplicate',
    relation_reason: 'same intent, same topic signal, within 14 days',
  }]), ['duplicate']);
  assert.deepEqual(automaticSameCaseTicketIds([{
    ticket_id: 'different-order',
    relation_reason: 'different order reference, same intent, same topic signal, within 14 days',
  }]), []);
});

test('customer-authored order references are extracted without trusting agent text', () => {
  assert.deepEqual(referencedOrderNamesFromMessages([
    { sender_type: 'agent', content: 'Order #9999 exists.' },
    { sender_type: 'customer', content: 'Please cancel order #1040.' },
    { sender_type: 'customer', content: 'My order number is WBD1025.' },
  ]), ['#1040', '#wbd1025']);
  assert.deepEqual(referencedOrderNamesFromText('Missing ORDER #1068'), ['#1068']);
});

test('an address unit after a street suffix is not mistaken for an order number', () => {
  assert.deepEqual(
    referencedOrderNamesFromText('Please ship to 1750 Glendale Blvd #418, Los Angeles, CA 90026.'),
    [],
  );
  assert.deepEqual(referencedOrderNamesFromText('Please update order #1153.'), ['#1153']);
});

test('plural order labels bind all adjacent references without scanning unrelated numbers', () => {
  assert.deepEqual(referencedOrderNamesFromText(
    'I made two purchases (Order Numbers 1390 and 1396). The sale went from 50% to 60%. 45 Rockefeller Plaza, NY 10111.',
  ), ['#1390', '#1396']);
  assert.deepEqual(referencedOrderNamesFromText('Orders 1117, 1118 and 1120 are late.'),
    ['#1117', '#1118', '#1120']);
  assert.deepEqual(referencedOrderNamesFromText('Order nos. WBD1025 & WBD1026'),
    ['#wbd1025', '#wbd1026']);
  assert.deepEqual(referencedOrderNamesFromMessages([
    { sender_type: 'agent', content: 'Order Numbers 9998 and 9999' },
    { sender_type: 'customer', content: 'Order Numbers 1390 and 1396\nOn Monday Support wrote:\nOrders 9998 and 9999' },
  ]), ['#1390', '#1396']);
});

test('email security and tracking tokens are not mistaken for order numbers', () => {
  assert.deepEqual(
    referencedOrderNamesFromText(
      'Open https://safe.example/aabie7dmmhxbd1wtdhbmyk7kq9a9m7xxxqbl21le4kagvoukjkn5x54nyc7y6z and use token B2B253F32150A4B0D5E1FFB548999C0D0BFE1CFB.',
    ),
    [],
  );
  assert.deepEqual(
    referencedOrderNamesFromText('My order number is WBD1025 and I need an update.'),
    ['#wbd1025'],
  );
  assert.deepEqual(
    referencedOrderNamesFromText('Quantity1 SUMMER25 /v3/ general-15 Ticket #3386'),
    ['#3386'],
  );
});

test('reply greeting is corrected to the customer-authored identity', () => {
  assert.equal(
    canonicalizeReplyGreeting('Hi Danilo,\n\nYour order is cancelled.', 'Michelle Salas'),
    'Hi Michelle,\n\nYour order is cancelled.',
  );
});

test('a direct lets-cancel instruction authorizes the active order', () => {
  assert.deepEqual(
    explicitCancellationOrderIds("Let's go ahead and cancel the entire order, thank you.", [
      { id: 'gid://shopify/Order/1110', name: '#1110' },
    ]),
    ['gid://shopify/Order/1110'],
  );
});

test('broad cancellation options are detected as proactive offers', () => {
  assert.equal(
    proactivelyOffersOrderCancellationOrRefund(
      "If you'd rather not wait, I can cancel either or both orders for a full refund.",
    ),
    true,
  );
});

test('a delivered first-person address confirmation clears the old authorization', () => {
  const order = { id: 'gid://shopify/Order/1254', name: '#1254' };
  const authorization = authorizedShippingAddressTextByOrder([
    {
      sender_type: 'customer',
      content: 'Please update order #1254 to 16100 S Great Oaks Dr, Apt 2103, Round Rock, TX 78681.',
    },
    {
      sender_type: 'agent',
      content: "I've updated the shipping address on order #1254.",
      metadata: { email_status: 'sent' },
    },
  ], [order]);
  assert.equal(authorization.size, 0);
});

test('a return case hashtag is not mistaken for a Shopify order number', () => {
  assert.deepEqual(
    referencedOrderNamesFromText('Return request #239C9A2F for order #7648'),
    ['#7648'],
  );
});

test('an email local-part is not mistaken for a configured order prefix', () => {
  assert.deepEqual(
    referencedOrderNamesFromText('Order #1068 - email: aventineluna007@gmail.com'),
    ['#1068'],
  );
});

test('an unsolicited cancellation option is detectable before a draft is shown', () => {
  assert.equal(
    proactivelyOffersOrderCancellationOrRefund(
      "If you'd like to cancel your order for a full refund, I can take care of that.",
    ),
    true,
  );
  assert.equal(
    proactivelyOffersOrderCancellationOrRefund(
      'Your order remains active and tracking will be sent when it ships.',
    ),
    false,
  );
});

test('customer signature names are available for Shopify name lookup', () => {
  assert.deepEqual(customerNameCandidatesFromMessages([
    {
      sender_type: 'customer',
      content: 'Hello,\n\nWhat is the status?\n\nThank you\n\nMel Campolo',
    },
  ]), ['mel campolo']);
});

test('customer-authored alternate emails are available for Shopify lookup', () => {
  assert.deepEqual(customerEmailCandidatesFromMessages([
    {
      sender_type: 'customer',
      content: 'My email address is Hbarnes667@gmail.com.',
    },
    {
      sender_type: 'agent',
      content: 'Contact support@warmbydesign.com.',
    },
  ]), ['hbarnes667@gmail.com']);
});

test('mail-client footers and email prompts are not mistaken for customer names', () => {
  assert.deepEqual(customerNameCandidatesFromMessages([
    {
      sender_type: 'customer',
      content: 'Can I get an update?\n\nMy email address is\nhbarnes667@gmail.com\n\nSent from my iPhone',
    },
  ]), []);
});

test('signature extraction prefers a real latest signature over prose fragments', () => {
  assert.deepEqual(customerNameCandidatesFromMessages([
    {
      sender_type: 'customer',
      content: 'If I do not receive an update, I will dispute it.\n\nBest,\nDallas Pagach',
    },
  ]), ['dallas pagach']);
  assert.deepEqual(customerNameCandidatesFromMessages([
    {
      sender_type: 'customer',
      content: 'Please let me know if you can help.\n\nThank you.\n\n-Justin',
    },
  ]), ['justin']);
  assert.deepEqual(customerNameCandidatesFromMessages([
    {
      sender_type: 'customer',
      content: "Let's cancel the order.\nSent on the go!\nBy sarth",
    },
  ]), ['sarth']);
});

test('verified order targets canonicalize a Shopify order number to its GID', () => {
  const orders = [
    { id: 'gid://shopify/Order/7322389741719', name: '#1040' },
    { id: 'gid://shopify/Order/999', name: '#1041' },
  ];
  assert.equal(
    resolveVerifiedOrderTarget('1040', '#1040', orders)?.id,
    'gid://shopify/Order/7322389741719',
  );
  assert.equal(
    resolveVerifiedOrderTarget('gid://shopify/Order/7322389741719', undefined, orders)?.name,
    '#1040',
  );
  assert.equal(resolveVerifiedOrderTarget('9999', '#9999', orders), null);
});

test('exact order number plus customer name can bind when ticket email differs', () => {
  assert.deepEqual(verifiedExplicitOrderIdentityEvidence({
    ticketName: 'Joshua Lipack',
    ticketEmail: 'josh@grabowskilawfirm.com',
    messages: [{ sender_type: 'customer', content: 'Please cancel order #1040.' }],
    liveCustomerEmail: 'joshua.lipack@gmail.com',
    liveCustomerName: 'Joshua Lipack',
  }), ['customer_name']);
});

test('customer-authored alternate email and phone strengthen explicit order identity', () => {
  assert.deepEqual(verifiedExplicitOrderIdentityEvidence({
    ticketName: 'Joshua Lipack',
    ticketEmail: 'josh@grabowskilawfirm.com',
    messages: [{
      sender_type: 'customer',
      content: 'It was under Joshua.lipack@gmail.com. Call me at (704) 620-2529.',
    }],
    liveCustomerEmail: 'joshua.lipack@gmail.com',
    liveShippingPhone: '+1 704 620 2529',
    liveCustomerName: 'Joshua Lipack',
  }), ['customer_email', 'customer_phone', 'customer_name']);
});

test('an unrelated explicit order remains blocked when no live identity matches', () => {
  assert.deepEqual(verifiedExplicitOrderIdentityEvidence({
    ticketName: 'Joshua Lipack',
    ticketEmail: 'josh@example.com',
    ticketPhone: '704-620-2529',
    messages: [{ sender_type: 'customer', content: 'Please cancel order #9999.' }],
    liveCustomerEmail: 'other@example.com',
    liveCustomerPhone: '212-555-0100',
    liveCustomerName: 'Someone Else',
  }), []);
});

test('an exact last-name match is sufficient for an explicitly referenced order', () => {
  assert.deepEqual(verifiedExplicitOrderIdentityEvidence({
    ticketName: 'Josh Lipack',
    ticketEmail: 'different@example.com',
    messages: [{ sender_type: 'customer', content: 'Please check order #1040.' }],
    liveCustomerEmail: 'checkout@example.com',
    liveCustomerName: 'Joshua Lipack',
  }), ['customer_last_name']);
});

test('professional credentials do not hide an exact customer-name match', () => {
  assert.deepEqual(verifiedExplicitOrderIdentityEvidence({
    ticketName: 'Tim Nguyen RN',
    ticketEmail: 'tim.nguyenrn@gmail.com',
    messages: [{ sender_type: 'customer', content: 'Please check on the lamp I ordered June 27.\n\nTim Nguyen' }],
    liveCustomerEmail: '',
    liveCustomerName: 'Tim Nguyen',
  }), ['customer_name']);
});

test('fulfilled cancellation remains reviewable but never restocks automatically', () => {
  const policy = cancellationPlanPolicy({ fulfillmentStatus: 'FULFILLED', trackingCount: 0 });

  assert.equal(policy.restock, false);
  assert.equal(policy.confidenceCap, 0.65);
  assert.match(policy.riskNote ?? '', /reply stays blocked until live cancellation is confirmed/i);
});

test('clearly unfulfilled cancellation can restock with a higher confidence ceiling', () => {
  const policy = cancellationPlanPolicy({ fulfillmentStatus: 'UNFULFILLED', trackingCount: 0 });

  assert.equal(policy.restock, true);
  assert.equal(policy.confidenceCap, 0.9);
  assert.equal(policy.riskNote, null);
});

test('tracking always disables restocking even when the display status says unfulfilled', () => {
  const policy = cancellationPlanPolicy({ fulfillmentStatus: 'UNFULFILLED', trackingCount: 1 });

  assert.equal(policy.restock, false);
  assert.equal(policy.confidenceCap, 0.45);
  assert.match(policy.riskNote ?? '', /tracking is present/i);
});

test('completed cancellation claim fails closed without a cancellation action', () => {
  const reply = 'Done — your order has been cancelled and the refund will return to your original payment method.';

  assert.deepEqual(claimedCompletedMutationOutcomes(reply), ['cancel_order']);
  assert.deepEqual(missingReplyOutcomeDependencies({
    replyText: reply,
    availableOutcomes: [],
  }), ['cancel_order']);
});

test('cancel action satisfies both cancellation and refund completion claims', () => {
  const reply = 'We have cancelled your order and processed the refund.';

  assert.deepEqual(missingReplyOutcomeDependencies({
    replyText: reply,
    availableOutcomes: ['cancel_order', 'refund_order'],
  }), []);
});

test('cancellation alone does not prove that money was refundable', () => {
  const reply = 'We cancelled your order and your refund will be returned.';
  assert.deepEqual(missingReplyOutcomeDependencies({
    replyText: reply,
    availableOutcomes: ['cancel_order'],
  }), ['refund_order']);
});

test('historical cancellation does not prove that a refund was issued', () => {
  const reply = 'The order was cancelled and your refund is on its way.';

  assert.deepEqual(missingReplyOutcomeDependencies({
    replyText: reply,
    availableOutcomes: [],
    historicalOutcomes: ['cancel_order'],
  }), ['refund_order']);
});

test('declared outcome dependencies fail closed even when the wording is indirect', () => {
  assert.deepEqual(missingReplyOutcomeDependencies({
    replyText: 'Everything is taken care of for order #1025.',
    declaredRequiredOutcomes: ['cancel_order'],
    availableOutcomes: [],
  }), ['cancel_order']);
});

test('questions and inability statements are not treated as completed outcomes', () => {
  assert.deepEqual(claimedCompletedMutationOutcomes('You asked us to cancel, but the order cannot be cancelled.'), []);
  assert.deepEqual(claimedCompletedMutationOutcomes('Would you like us to update your shipping address?'), []);
  assert.deepEqual(claimedCompletedMutationOutcomes('We did not take care of your refund.'), []);
  assert.deepEqual(claimedCompletedMutationOutcomes('Your refund is not done.'), []);
  assert.deepEqual(claimedCompletedMutationOutcomes('We could not finalize your refund.'), []);
  assert.deepEqual(claimedCompletedMutationOutcomes('Was your address change successful?'), []);
  assert.deepEqual(claimedCompletedMutationOutcomes('Did the shipping address change succeed?'), []);
  assert.deepEqual(claimedCompletedMutationOutcomes('Your cancellation request was not completed.'), []);
});

test('success synonyms require their verified mutation actions', () => {
  const cases: Array<[string, 'cancel_order' | 'refund_order' | 'update_shipping_address']> = [
    ['We took care of your refund.', 'refund_order'],
    ['Your refund is done.', 'refund_order'],
    ['We finalized your refund.', 'refund_order'],
    ['Your address change was successful.', 'update_shipping_address'],
    ['The shipping address change succeeded.', 'update_shipping_address'],
    ['Your cancellation request was completed.', 'cancel_order'],
    ['We have taken care of the refund.', 'refund_order'],
    ['Your reimbursement is done.', 'refund_order'],
    ['We finalized the reimbursement.', 'refund_order'],
    ['The address correction was successful.', 'update_shipping_address'],
    ['The delivery address change went through.', 'update_shipping_address'],
    ['Your cancellation request succeeded.', 'cancel_order'],
    ['The order cancellation request is complete.', 'cancel_order'],
  ];
  for (const [replyText, outcome] of cases) {
    assert.deepEqual(claimedCompletedMutationOutcomes(replyText), [outcome]);
    assert.deepEqual(missingReplyOutcomeDependencies({ replyText, availableOutcomes: [] }), [outcome]);
  }
});

test('currency claims are parsed for deterministic refund grounding', () => {
  assert.deepEqual(claimedCurrencyAmounts('A refund of $417.95 (USD 417.95) was submitted.'), [417.95]);
});

test('explicit cancellation intent binds to the referenced live order', () => {
  const orders = [
    { id: 'gid://shopify/Order/1025', name: '#1025', cancelledAt: null },
    { id: 'gid://shopify/Order/1026', name: '#1026', cancelledAt: null },
  ];
  assert.deepEqual(
    explicitCancellationOrderIds('Are you able to cancel my order #1025?', orders),
    ['gid://shopify/Order/1025'],
  );
});

test('contracted cancellation plus refund wording authorizes the sole live order', () => {
  const orders = [{ id: 'one', name: '#1163', cancelledAt: null }];
  const request = "Hello - I'd like to cancel my order and receive a refund, due to the long delay in delivery.";

  assert.deepEqual(explicitCancellationOrderIds(request, orders), ['one']);
  assert.deepEqual(authorizedRefundOrderIdsFromMessages([
    { sender_type: 'customer', content: request },
  ], orders), ['one']);
  assert.deepEqual([...authorizedRefundAmountByOrderFromMessages([
    { sender_type: 'customer', content: request },
  ], orders)], [['one', null]]);
});

test('smart apostrophes and direct passive cancellation remain authorizing', () => {
  const orders = [{ id: 'one', name: '#1163', cancelledAt: null }];
  for (const request of [
    'I’d like to cancel my order.',
    'I’d rather to cancel my order.',
    'I need my order cancelled.',
  ]) {
    assert.deepEqual(explicitCancellationOrderIds(request, orders), ['one']);
  }
});

test('natural go-ahead cancellation wording authorizes the sole live order', () => {
  const orders = [{ id: 'one', name: '#1005', cancelledAt: null }];
  assert.deepEqual(
    explicitCancellationOrderIds(
      'In that case I’d like to go ahead and cancel the order.',
      orders,
    ),
    ['one'],
  );
  assert.deepEqual(
    explicitCancellationOrderIds(
      'Can you please go ahead and cancel my order?',
      orders,
    ),
    ['one'],
  );
});

test('passive cancel-and-refund wording authorizes stopping and refunding the order', () => {
  const orders = [{
    id: 'one',
    name: '#1127',
    cancelledAt: null,
    totalPrice: '270.00',
    totalRefunded: 0,
    financialStatus: 'PAID',
  }];
  const request = 'A discount will not be necessary. I would just like my order to be cancelled, and payment refunded in full. Please confirm ASAP that this is done.';
  assert.deepEqual(explicitCancellationOrderIds(request, orders), ['one']);
  assert.deepEqual([...authorizedRefundAmountByOrderFromMessages([
    { sender_type: 'customer', content: request },
  ], orders)], [['one', null]]);
});

test('customer-reported completed cancellation authorizes repairing a still-active order', () => {
  const orders = [{ id: 'one', name: '#1149', cancelledAt: null }];
  assert.deepEqual(
    explicitCancellationOrderIds('I have already cancelled my order.', orders),
    ['one'],
  );
});

test('a sole-order refund request also authorizes cancellation so fulfillment stops', () => {
  const orders = [{ id: 'one', name: '#1059', cancelledAt: null }];
  assert.deepEqual(
    authorizedCancellationOrderIdsFromMessages([{
      sender_type: 'customer',
      content: 'Ok, I’d like a refund then and I’ll order it when it is back in stock.',
    }], orders),
    ['one'],
  );
});

test('contracted cancellation and refund questions remain non-authorizing', () => {
  const orders = [{ id: 'one', name: '#1163', cancelledAt: null }];

  for (const request of [
    "I'd like to know whether I can cancel my order and receive a refund.",
    'Would I receive a refund if I cancel my order?',
  ]) {
    assert.deepEqual(explicitCancellationOrderIds(request, orders), []);
    assert.deepEqual(authorizedRefundOrderIdsFromMessages([
      { sender_type: 'customer', content: request },
    ], orders), []);
  }
  assert.deepEqual(
    explicitCancellationOrderIds("I'd like to cancel order #9999 and receive a refund.", orders),
    [],
  );
  assert.deepEqual(authorizedRefundOrderIdsFromMessages([
    { sender_type: 'customer', content: "I'd like to cancel order #9999 and receive a refund." },
  ], orders), []);
});

test('negated or ambiguous cancellation language never authorizes a mutation', () => {
  const orders = [
    { id: 'one', name: '#1025', cancelledAt: null },
    { id: 'two', name: '#1026', cancelledAt: null },
  ];
  assert.deepEqual(explicitCancellationOrderIds("I don't want to cancel order #1025", orders), []);
  assert.deepEqual(explicitCancellationOrderIds('Can you cancel my order?', orders), []);
  assert.deepEqual(explicitCancellationOrderIds('Can you tell me whether I can cancel my order?', [orders[0]]), []);
  assert.deepEqual(explicitCancellationOrderIds('Could you check if I can cancel order #1025?', [orders[0]]), []);
  assert.deepEqual(explicitCancellationOrderIds('I want to know whether I can cancel order #1025.', [orders[0]]), []);
  assert.deepEqual(explicitCancellationOrderIds('Please cancel order #1025 if it has not shipped.', [orders[0]]), []);
  assert.deepEqual(explicitCancellationOrderIds('Please cancel order #1024', [
    { id: 'old', name: '#1024', cancelledAt: '2026-07-01T00:00:00Z' },
    { id: 'live', name: '#1025', cancelledAt: null },
  ]), []);
  assert.deepEqual(explicitCancellationOrderIds(
    'Any update?\n\n---------- Forwarded message ----------\nPlease cancel order #1025',
    orders,
  ), []);
  assert.equal(revokesCancellationRequest("I changed my mind — please don't cancel it."), true);
});

test('deferrals, conditions, and sub-operation wording never authorize a whole-order cancellation', () => {
  const orders = [{
    id: 'one',
    name: '#1163',
    cancelledAt: null,
    lineItems: [{ title: 'Aspen Lamp' }],
  }];
  for (const request of [
    "I'd like to cancel my order, but don't do it yet.",
    "I'd like to cancel my order, but not yet.",
    "I'd like to cancel my order unless it has shipped.",
    'Please cancel one Aspen Lamp from order #1163.',
    'Please cancel the refund request for order #1163.',
    'Please cancel the replacement for order #1163.',
    "Need an ETA on when I'll receive it, or I'd like to cancel my order.",
  ]) {
    assert.deepEqual(explicitCancellationOrderIds(request, orders), [], request);
    assert.deepEqual(authorizedRefundOrderIdsFromMessages([
      { sender_type: 'customer', content: `${request} and receive a refund.` },
    ], orders), [], request);
  }
});

test('configured order prefixes are exact and never fall back to another live order', () => {
  const orders = [
    { id: 'old', name: '#WBD1024', cancelledAt: '2026-07-01T00:00:00Z' },
    { id: 'live', name: '#WBD1025', cancelledAt: null },
  ];
  assert.deepEqual(explicitCancellationOrderIds('Please cancel order WBD1024.', orders), []);
  assert.deepEqual(explicitCancellationOrderIds('Please cancel #WBD9999.', orders), []);
  assert.deepEqual(explicitCancellationOrderIds('Please cancel order #WBD1025.', orders), ['live']);
});

test('a later instead request replaces the earlier cancellation target', () => {
  const orders = [
    { id: 'one', name: '#1025', cancelledAt: null },
    { id: 'two', name: '#1026', cancelledAt: null },
  ];
  assert.deepEqual(authorizedCancellationOrderIdsFromMessages([
    { sender_type: 'customer', content: 'Please cancel #1025.' },
    { sender_type: 'customer', content: 'Actually, cancel #1026 instead.' },
  ], orders), ['two']);
});

test('a generic delivered update keeps intent, but a terminal disposition clears it', () => {
  const orders = [{ id: 'one', name: '#1025', cancelledAt: null }];
  assert.deepEqual(authorizedCancellationOrderIdsFromMessages([
    { sender_type: 'customer', content: 'Please cancel order #1025.' },
    { sender_type: 'agent', content: 'We are checking this for you.', metadata: { email_status: 'sent' } },
    { sender_type: 'customer', content: 'Any update?' },
  ], orders), ['one']);
  assert.deepEqual(authorizedCancellationOrderIdsFromMessages([
    { sender_type: 'customer', content: 'Please cancel order #1025.' },
    { sender_type: 'agent', content: 'We were unable to cancel the order.', metadata: { email_status: 'delivered' } },
    { sender_type: 'customer', content: 'Thanks.' },
  ], orders), []);
});

test('a missing-refund follow-up restores authorization for a cancelled order with a paid balance', () => {
  const cancelledOrder = {
    id: 'gid://shopify/Order/1088',
    name: '#1088',
    cancelledAt: '2026-08-12T07:00:00.000Z',
    totalPrice: '442.50 USD',
    totalRefunded: 0,
    financialStatus: 'PAID',
  };
  const authorization = authorizedRefundAmountByOrderFromMessages([
    { sender_type: 'customer', content: 'Please cancel order #1088 and give me a full refund.' },
    {
      sender_type: 'agent',
      content: 'I cancelled #1088 and your refund will go back to the original payment method.',
      metadata: { email_status: 'delivered' },
    },
    { sender_type: 'customer', content: "It has been a week and I still haven't received my refund. Can I get an update?" },
  ], [cancelledOrder]);

  assert.deepEqual([...authorization], [[cancelledOrder.id, 442.5]]);
});

test('a missing-refund follow-up never reauthorizes an already refunded order', () => {
  const refundedOrder = {
    id: 'gid://shopify/Order/1065',
    name: '#1065',
    cancelledAt: '2026-08-07T07:00:00.000Z',
    totalPrice: '576.25',
    totalRefunded: 576.25,
    financialStatus: 'REFUNDED',
  };
  assert.deepEqual([...authorizedRefundAmountByOrderFromMessages([
    { sender_type: 'customer', content: "I still haven't received my refund. Can you confirm it was initiated?" },
  ], [refundedOrder])], []);
});

test('taken-care-of wording is treated as a completed mutation claim', () => {
  assert.deepEqual(claimedCompletedMutationOutcomes('I took care of the cancellation.'), ['cancel_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes("I've now cancelled order #1034 as requested."), ['cancel_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes("I've issued the requested refund for #1128."), ['refund_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes("I've corrected the shipping address on #1254."), ['update_shipping_address']);
  assert.deepEqual(claimedCompletedMutationOutcomes('The order cancellation is all set.'), ['cancel_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes('Your refund was taken care of.'), ['refund_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes('A full refund will be returned to your card.'), ['refund_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes('You will receive a full refund.'), ['refund_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes('The shipping address change is all set.'), ['update_shipping_address']);
  for (const text of [
    'Cancellation is done.',
    'We processed your cancellation.',
    'Your order has been voided.',
    'Your cancellation has been processed.',
    'Your cancellation has been completed.',
    'Your cancellation was successful.',
    'The cancellation succeeded.',
  ]) assert.deepEqual(claimedCompletedMutationOutcomes(text), ['cancel_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes('The refund went through.'), ['refund_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes('Your refund is complete.'), ['refund_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes('We completed your refund.'), ['refund_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes('Your refund was successful.'), ['refund_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes('The refund succeeded.'), ['refund_order']);
  assert.deepEqual(claimedCompletedMutationOutcomes('Your shipping address update was successful.'), ['update_shipping_address']);
});

test('ticket consolidation requires topical evidence beyond a shared order', () => {
  assert.equal(passesRelatedTicketCandidateGate({
    score: 0.8, basis: ['same_order_reference', 'within_14_days'], deterministic: false,
  }), false);
  assert.equal(passesRelatedTicketCandidateGate({
    score: 0.92, basis: ['same_order_reference', 'same_intent'], deterministic: false,
  }), true);
  assert.equal(passesRelatedTicketCandidateGate({
    score: 0.73, basis: ['same_intent', 'same_topic_signal', 'within_14_days'], deterministic: false,
  }), true);
  assert.equal(passesRelatedTicketCandidateGate({
    score: 1, basis: ['same_chat_escalation'], deterministic: true,
  }), true);
});

test('refund mutations require direct unresolved intent bound to the order', () => {
  const orders = [
    { id: 'one', name: '#WBD1025', cancelledAt: null },
    { id: 'two', name: '#WBD1026', cancelledAt: null },
  ];
  assert.deepEqual(authorizedRefundOrderIdsFromMessages([
    { sender_type: 'customer', content: 'Can you tell me the refund policy for #WBD1025?' },
  ], orders), []);
  assert.deepEqual(authorizedRefundOrderIdsFromMessages([
    { sender_type: 'customer', content: 'Please issue me a refund for order #WBD1025.' },
  ], orders), ['one']);
  assert.deepEqual(authorizedRefundOrderIdsFromMessages([
    { sender_type: 'customer', content: 'Please refund order #WBD1025.' },
    { sender_type: 'agent', content: 'The refund has been processed.', metadata: { email_status: 'sent' } },
  ], orders), []);
});

test('an urgent full-refund demand authorizes refund and stopping the active order', () => {
  const orders = [{ id: 'one', name: '#1040', cancelledAt: null }];
  const messages = [
    {
      sender_type: 'customer' as const,
      content: 'Please advise or cancel the order and issue a refund. Order #1040.',
    },
    {
      sender_type: 'customer' as const,
      content: 'I need someone to get back to me about a refund ASAP.',
    },
    {
      sender_type: 'customer' as const,
      content: "If I don't get a response & full refund today, I will file complaints.",
    },
  ];
  assert.deepEqual(authorizedRefundOrderIdsFromMessages(messages, orders), ['one']);
  assert.deepEqual(authorizedCancellationOrderIdsFromMessages(messages, orders), ['one']);
});

test('a direct whole-order refund request also stops the active order', () => {
  const orders = [{ id: 'one', name: '#1085', cancelledAt: null }];
  const direct = [{
    sender_type: 'customer' as const,
    content: 'Please refund my order. I do not want it and this is taking way longer than expected.',
  }];
  assert.deepEqual(authorizedRefundOrderIdsFromMessages(direct, orders), ['one']);
  assert.deepEqual(authorizedCancellationOrderIdsFromMessages(direct, orders), ['one']);

  const conditional = [{
    sender_type: 'customer' as const,
    content: 'If it has not shipped by August, please refund my order.',
  }];
  assert.deepEqual(authorizedCancellationOrderIdsFromMessages(conditional, orders), []);
});

test('a future-progressive cancellation request authorizes stopping the order before shipment', () => {
  const active = [{ id: 'one', name: '#1025', cancelledAt: null }];
  assert.deepEqual(
    explicitCancellationOrderIds(
      'I will need to be cancelling my order. Can we do that here before it gets shipped?',
      active,
    ),
    ['one'],
  );
});

test('an ETA-or-cancel alternative without a later demand remains read-only', () => {
  const orders = [{ id: 'one', name: '#1055', cancelledAt: null }];
  const messages = [{
    sender_type: 'customer' as const,
    content: "Need an ETA on when I'll receive it, or I'd like to cancel my order.",
  }];
  assert.deepEqual(authorizedCancellationOrderIdsFromMessages(messages, orders), []);
  assert.deepEqual(authorizedRefundOrderIdsFromMessages(messages, orders), []);
});

test('terminal and revocation messages clear only their referenced order', () => {
  const orders = [
    { id: 'one', name: '#WBD1025', cancelledAt: null },
    { id: 'two', name: '#WBD1026', cancelledAt: null },
  ];
  assert.deepEqual(authorizedCancellationOrderIdsFromMessages([
    { sender_type: 'customer', content: 'Please cancel order #WBD1025 and order #WBD1026.' },
    { sender_type: 'agent', content: 'Order #WBD1025 has been cancelled.', metadata: { email_status: 'sent' } },
  ], orders), ['two']);
  assert.deepEqual(authorizedCancellationOrderIdsFromMessages([
    { sender_type: 'customer', content: 'Please cancel order #WBD1025 and order #WBD1026.' },
    { sender_type: 'customer', content: "Actually, don't cancel #WBD1025." },
  ], orders), ['two']);
});

test('common rescissions and deferrals clear an outstanding cancellation authorization', () => {
  const orders = [{ id: 'one', name: '#WBD1025', cancelledAt: null }];
  for (const rescission of [
    'Never mind, keep the order.',
    'I changed my mind.',
    "I don't want you to cancel it.",
    "Don't do it yet.",
    'Please hold off on the cancellation.',
  ]) {
    assert.deepEqual(authorizedCancellationOrderIdsFromMessages([
      { sender_type: 'customer', content: 'Please cancel order #WBD1025.' },
      { sender_type: 'customer', content: rescission },
    ], orders), [], rescission);
  }
  assert.deepEqual(authorizedCancellationOrderIdsFromMessages([
    { sender_type: 'customer', content: 'Please cancel my order.' },
    { sender_type: 'customer', content: 'Please confirm that you proceeded with the order.' },
  ], orders), []);
});

test('a quoted refund amount caps authorization to that exact amount', () => {
  const orders = [{ id: 'one', name: '#WBD1025', cancelledAt: null }];
  assert.deepEqual(
    [...authorizedRefundAmountByOrderFromMessages([
      { sender_type: 'customer', content: 'Please refund $10.00 on #WBD1025.' },
    ], orders)],
    [['one', 10]],
  );
  assert.deepEqual(
    [...authorizedRefundAmountByOrderFromMessages([
      { sender_type: 'customer', content: 'Please refund 10 dollars on #WBD1025.' },
    ], orders)],
    [['one', 10]],
  );
  assert.equal(authorizedRefundAmountByOrderFromMessages([
    { sender_type: 'customer', content: 'Please refund the shipping fee on #WBD1025.' },
  ], orders).size, 0);
  const productOrders = [{ ...orders[0], lineItems: [{ title: 'Aspen Lamp' }] }];
  assert.equal(authorizedRefundAmountByOrderFromMessages([
    { sender_type: 'customer', content: 'Please refund one Aspen Lamp on #WBD1025.' },
  ], productOrders).size, 0);
  assert.equal(authorizedRefundAmountByOrderFromMessages([
    { sender_type: 'customer', content: 'Please refund the Aspen Lamp on #WBD1025.' },
  ], productOrders).size, 0);
  assert.equal(authorizedRefundAmountByOrderFromMessages([
    { sender_type: 'customer', content: 'Please refund one item on #WBD1025.' },
  ], orders).size, 0);
});

test('unpriced partial-refund wording never unlocks the whole remaining balance', () => {
  const orders = [{
    id: 'one',
    name: '#WBD1025',
    cancelledAt: null,
    lineItems: [{ title: 'Aspen Lamp' }, { title: 'Oak Table Lamp' }],
  }];
  for (const content of [
    'Please refund one of the lamps on #WBD1025.',
    'Please refund half of the order #WBD1025.',
    'Please refund the damaged lamp on #WBD1025.',
  ]) {
    assert.equal(authorizedRefundAmountByOrderFromMessages([
      { sender_type: 'customer', content },
    ], orders).size, 0);
  }

  assert.deepEqual([...authorizedRefundAmountByOrderFromMessages([
    { sender_type: 'customer', content: 'Please issue me a full refund for #WBD1025.' },
  ], orders)], [['one', null]]);
  assert.deepEqual([...authorizedRefundAmountByOrderFromMessages([
    { sender_type: 'customer', content: 'Please refund the whole order #WBD1025.' },
  ], orders)], [['one', null]]);
  assert.deepEqual([...authorizedRefundAmountByOrderFromMessages([
    { sender_type: 'customer', content: 'Please refund $25 for the damaged lamp on #WBD1025.' },
  ], orders)], [['one', 25]]);
});

test('non-order cancellation domains never use sole-order fallback', () => {
  const orders = [{ id: 'one', name: '#WBD1025', cancelledAt: null }];
  assert.deepEqual(explicitCancellationOrderIds('Please cancel my subscription.', orders), []);
  assert.deepEqual(explicitCancellationOrderIds('Please cancel my subscription for order #WBD1025.', orders), []);
  assert.deepEqual(explicitCancellationOrderIds('Please cancel the return for order #WBD1025.', orders), []);
  assert.deepEqual(explicitCancellationOrderIds('Please cancel my warranty on #WBD1025.', orders), []);
  assert.deepEqual(explicitCancellationOrderIds('Please cancel WBD1025.', orders), ['one']);
});

test('targeted refund completion clears the exact outstanding authorization', () => {
  const orders = [{ id: 'one', name: '#WBD1025', cancelledAt: null }];
  assert.deepEqual(authorizedRefundOrderIdsFromMessages([
    { sender_type: 'customer', content: 'Please refund USD 10 on #WBD1025.' },
    { sender_type: 'agent', content: 'Refund for order #WBD1025 has been processed.', metadata: { email_status: 'sent' } },
  ], orders), []);
});

test('address updates require an explicit request and verbatim address values', () => {
  const orders = [{ id: 'one', name: '#1025', cancelledAt: null }];
  const authorization = authorizedShippingAddressTextByOrder([
    {
      sender_type: 'customer',
      content: 'Please update the shipping address for #1025 to 12 Oak Lane, Austin, TX 78701, United States.',
    },
  ], orders);
  const source = authorization.get('one') ?? '';
  assert.ok(source);
  assert.equal(addressValueAppearsInAuthorizedText('12 Oak Lane', source), true);
  assert.equal(addressValueAppearsInAuthorizedText('Austin', source), true);
  assert.equal(addressValueAppearsInAuthorizedText('99 Invented Road', source), false);
  assert.equal(authorizedShippingAddressTextByOrder([
    { sender_type: 'customer', content: 'Can I change my shipping address?' },
  ], orders).size, 0);
});

test('a street address unit does not block sole-order address authorization', () => {
  const orders = [{ id: 'one', name: '#1153', cancelledAt: null }];
  const authorized = authorizedShippingAddressTextByOrder([{
    sender_type: 'customer',
    content: 'Please change the shipping address to:\n\n1750 Glendale Blvd #418, Los Angeles, CA 90026',
  }], orders);
  assert.equal(authorized.has('one'), true);
  assert.match(authorized.get('one') ?? '', /glendale blvd #418/i);
});

test('a customer correction of a wrong apartment number authorizes and parses the sole order', () => {
  const orders = [{ id: 'one', name: '#1254', cancelledAt: null }];
  const content = [
    'Hello,',
    'I realized after I placed this order that I entered my apartment number',
    'wrong.',
    'The correct adress for delivery and billing address is;',
    '16100 S Great Oaks Dr',
    'Apt # 2103',
    'Round Rock TX 78681',
    'Please let me know if you received this correction before the order ships.',
  ].join('\n\n');
  const authorized = authorizedShippingAddressTextByOrder([
    { sender_type: 'customer', content },
  ], orders);

  assert.deepEqual([...authorized.keys()], ['one']);
  assert.deepEqual(extractAuthorizedShippingAddressUpdate(authorized.get('one') ?? ''), {
    ok: true,
    address: {
      address1: '16100 S Great Oaks Dr',
      address2: 'Apt # 2103',
      city: 'Round Rock',
      province: 'TX',
      zip: '78681',
    },
  });
});

test('a refund amount in an unresolved status reply is not a completion claim', () => {
  assert.deepEqual(
    completedRefundAmountsRequiringAction(
      'I am sorry that the $461.30 refund still has not appeared. I am checking its status.',
    ),
    [],
  );
  assert.deepEqual(
    completedRefundAmountsRequiringAction('Your refund was processed. The amount is $461.30.'),
    [461.3],
  );
  assert.deepEqual(
    claimedCompletedMutationOutcomes(
      'Your refund of $461.30 is owed to you and will be processed today.',
    ),
    ['refund_order'],
  );
  assert.deepEqual(
    claimedCompletedMutationOutcomes(
      'I will personally ensure our team actions your $461.30 refund today.',
    ),
    ['refund_order'],
  );
  assert.deepEqual(
    claimedCompletedMutationOutcomes(
      'Your refund of $461.30 has been processed successfully.',
    ),
    ['refund_order'],
  );
});

test('passive delivery wording and "order number is" authorize only the named order', () => {
  const orders = [
    { id: 'target', name: '#1138', cancelledAt: null },
    { id: 'other', name: '#2200', cancelledAt: null },
  ];
  const message = [
    'I\u2019ve moved addresses. Can my order please be delivered to the following address instead of the original on-file?',
    '1750 Glendale Blvd, Apt 418, Los Angeles, CA 90026',
    'My order number is 1138.',
  ].join('\n\n');

  assert.deepEqual(
    [...authorizedShippingAddressTextByOrder([
      { sender_type: 'customer', content: message },
    ], orders).keys()],
    ['target'],
  );
});

test('a customer change question authorizes only when the same message supplies the new destination', () => {
  const orders = [{ id: 'target', name: '#7622', cancelledAt: null }];
  const message = [
    'Can I change the ship to address? I have moved to:',
    'Carol Fleisig',
    '4 Chelsea Blvd',
    'Apt #a1701',
    'Houston, Tx 77006',
  ].join('\n');

  assert.deepEqual(
    [...authorizedShippingAddressTextByOrder([
      { sender_type: 'customer', content: message },
    ], orders).keys()],
    ['target'],
  );
  assert.equal(
    authorizedShippingAddressTextByOrder([
      { sender_type: 'customer', content: 'Can I change my shipping address?' },
    ], orders).size,
    0,
  );
});

test('address reroute questions and conditional requests remain non-executable', () => {
  const orders = [{ id: 'target', name: '#1138', cancelledAt: null }];
  const messages = [
    'Can my order be delivered to a PO box? Order #1138.',
    'What address will order #1138 be delivered to?',
    'Can my order be delivered to the following address if it has not shipped? Order #1138.',
  ];

  for (const content of messages) {
    assert.equal(
      authorizedShippingAddressTextByOrder([
        { sender_type: 'customer', content },
      ], orders).size,
      0,
      content,
    );
  }
});

test('shipping address canonicalization keeps exact new location fields and drops inferred live fields', () => {
  const source = [
    'Please deliver order #1138 to the following address:',
    '1750 Glendale Blvd, Apt 418, Los Angeles, CA 90026',
  ].join('\n');
  const result = canonicalizeAuthorizedShippingAddressUpdate({
    name: 'Gavin Lafferty',
    address1: '1750 Glendale Blvd',
    address2: 'Apt 418',
    city: 'Los Angeles',
    province: 'CA',
    zip: '90026',
    country: 'United States',
    phone: '555-0100',
  }, source);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.address, {
    address1: '1750 Glendale Blvd',
    address2: 'Apt 418',
    city: 'Los Angeles',
    province: 'CA',
    zip: '90026',
  });
});

test('shipping address canonicalization rejects any invented changed location field', () => {
  const result = canonicalizeAuthorizedShippingAddressUpdate({
    address1: '99 Invented Road',
    city: 'Los Angeles',
    province: 'CA',
    zip: '90026',
  }, 'Please deliver order #1138 to 1750 Glendale Blvd, Los Angeles, CA 90026.');

  assert.deepEqual(result, {
    ok: false,
    error: 'address field address1 was not copied verbatim from the authorizing message',
  });
});
