import assert from 'node:assert/strict';
import test from 'node:test';
import type { ShopifyOrderSummary } from './customer-profile.service.js';
import { claimedCompletedMutationOutcomes } from './autopilot-action-policy.js';
import {
  buildRepairedSupportDraft,
  buildSafeGoodwillSupportDraft,
  buildSafeLatestCustomerRequestDraft,
  buildSafeLegacyRefundRecoveryDraft,
  buildSafeOperatorDirectedRevisionDraft,
  buildSafeReadOnlyOrderStatusDraft,
  buildSafeRestockInterestDraft,
  buildSafeUnresolvedLegacyRefundDraft,
  buildSafeVerifiedRefundStatusDraft,
} from './autopilot-safe-draft.js';

const order: ShopifyOrderSummary = {
  id: 'gid://shopify/Order/1068',
  name: '#1068',
  totalPrice: '185.45',
  financialStatus: 'PAID',
  fulfillmentStatus: 'UNFULFILLED',
  lineItems: [{ title: 'Lamp', quantity: 1, variantTitle: null }],
  tracking: [],
  fulfillments: [],
  createdAt: '2026-05-31T00:00:00.000Z',
  cancelledAt: null,
  closedAt: null,
};

test('builds a grounded non-mutating draft for one verified missing-order inquiry', () => {
  const draft = buildSafeReadOnlyOrderStatusDraft({
    subject: 'Missing ORDER #1068',
    threadText: 'What is the status of my missing order? It has been over 6 weeks.',
    supportContext: 'For the active fulfillment delay, give an honest estimate of about another month.',
    orders: [order],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    responseState: 'awaiting_us',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  });
  assert.ok(draft);
  assert.match(String(draft.actions[0]?.params.reply_text), /Order #1068 has not shipped yet/);
  assert.match(String(draft.actions[0]?.params.reply_text), /last published shipping estimate was about one month from the time of that update/);
  assert.match(String(draft.actions[0]?.params.reply_text), /fresh shipping date has not been confirmed/);
  assert.doesNotMatch(String(draft.actions[0]?.params.reply_text), /about two weeks/);
  assert.equal(draft.actions.some((action) => action.type === 'send_reply'), true);
  assert.equal(draft.actions.some((action) => action.type === 'resolve'), true);
  assert.equal(draft.actions.some((action) => (
    action.type === ('cancel_order' as SafeActionType)
    || action.type === ('refund_order' as SafeActionType)
  )), false);
});

test('current owner three-week baseline supersedes older estimates without promising a date', () => {
  const draft = buildSafeReadOnlyOrderStatusDraft({
    subject: 'Where is my order?', threadText: 'Where is order #1068?',
    supportContext: 'OWNER UPDATE (2026-09-16): The baseline is about THREE WEEKS UNTIL SHIPPING. Previous guidance was two weeks.',
    orders: [order], signoffBlock: 'Support', responseState: 'awaiting_us',
    authorizedCancellationCount: 0, authorizedRefundCount: 0, authorizedAddressChangeCount: 0,
  });
  assert.ok(draft);
  const reply = String(draft.actions[0]?.params.reply_text);
  assert.match(reply, /updated 2026-09-16/);
  assert.match(reply, /about three weeks until shipment/);
  assert.match(reply, /exact shipping date is unconfirmed/);
  assert.doesNotMatch(reply, /two weeks|three weeks from today/);
});

test('does not replace a plan when a mutation is authorized', () => {
  assert.equal(buildSafeReadOnlyOrderStatusDraft({
    subject: 'Order status',
    threadText: 'Please cancel order #1068.',
    supportContext: 'About another month.',
    orders: [order],
    signoffBlock: 'Support',
    responseState: 'awaiting_us',
    authorizedCancellationCount: 1,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  }), null);
});

test('requires a unique verified target when several orders exist', () => {
  const other = { ...order, id: 'gid://shopify/Order/1070', name: '#1070' };
  assert.equal(buildSafeReadOnlyOrderStatusDraft({
    subject: 'Where is my order?',
    threadText: 'Can I get an update?',
    supportContext: 'About another month.',
    orders: [order, other],
    signoffBlock: 'Support',
    responseState: 'awaiting_us',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  }), null);
});

test('carries forward an explicitly named multi-order set for a plural follow-up', () => {
  const other = { ...order, id: 'gid://shopify/Order/1070', name: '#1070' };
  const draft = buildSafeReadOnlyOrderStatusDraft({
    subject: 'Order status',
    threadText: [
      'Customer: Please check order #1068 and order #1070.',
      'Agent: Both orders are delayed.',
      'Customer: Do we have any new updates on these orders?',
    ].join('\n'),
    latestCustomerMessage: 'Do we have any new updates on these orders?',
    customerName: 'Josh Rosen',
    supportContext: 'For the active delay, use about another month.',
    orders: [order, other],
    signoffBlock: 'Support',
    responseState: 'awaiting_us',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  });
  assert.ok(draft);
  const reply = String(draft.actions[0]?.params.reply_text);
  assert.match(reply, /^Hi Josh,/);
  assert.match(reply, /Orders #1068 and #1070 have not shipped yet/);
  assert.match(reply, /about one month from the time of that update/);
});

test('does not draft a duplicate status reply while awaiting the customer', () => {
  assert.equal(buildSafeReadOnlyOrderStatusDraft({
    subject: 'Order #1068 status',
    threadText: 'Customer: Where is my order?\nAgent: Reply with your preferred option.',
    supportContext: 'About another month.',
    orders: [order],
    signoffBlock: 'Support',
    responseState: 'awaiting_customer',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  }), null);
});

test('a concrete operator delivery revision overrides the stale generic draft', () => {
  const secondOrder = { ...order, id: 'gid://shopify/Order/1084', name: '#1084' };
  const draft = buildSafeOperatorDirectedRevisionDraft({
    instruction: 'Realistically, not in the first week, but within the month of September for sure. Things are moving now, but a bunch of backed-up orders are being fulfilled. Apologize, be sincere, and thankful.',
    subject: 'Order #1024',
    threadText: 'Customer previously asked about order #1024 and order #1084.',
    latestCustomerMessage: 'Would it be possible to receive these lamps by the first week of September?',
    customerName: 'Bhanu Jain',
    orders: [{ ...order, id: 'gid://shopify/Order/1024', name: '#1024' }, secondOrder],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    responseState: 'awaiting_us',
  });
  assert.ok(draft);
  const reply = String(draft.actions[0]?.params.reply_text);
  assert.match(reply, /^Hi Bhanu,/);
  assert.match(reply, /can't guarantee arrival during the first week of September/i);
  assert.match(reply, /#1024 and #1084 will be fulfilled within September/i);
  assert.match(reply, /working carefully through a large backlog/i);
  assert.match(reply, /truly appreciate your patience/i);
  assert.doesNotMatch(reply, /one detail you want us to act on/i);
  assert.ok(draft.overall_confidence >= 0.9);
});

test('a live refunded order gets a precise bank-posting follow-up instead of a generic request', () => {
  const refundedOrder: ShopifyOrderSummary = {
    ...order,
    id: 'gid://shopify/Order/1065',
    name: '#1065',
    totalPrice: '576.25',
    totalRefunded: 576.25,
    financialStatus: 'REFUNDED',
    cancelledAt: '2026-08-07T07:33:31.000Z',
  };
  const draft = buildSafeVerifiedRefundStatusDraft({
    subject: 'Taking Too Long, refund',
    threadText: 'Earlier reply: we cancelled order #1065 and the refund will return to the original payment method.',
    latestCustomerMessage: "I still haven't received my refund. Can you confirm it was initiated?",
    customerName: 'Cory Conrad',
    orders: [refundedOrder],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    responseState: 'awaiting_us',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  });
  assert.ok(draft);
  const reply = String(draft.actions[0]?.params.reply_text);
  assert.match(reply, /refund for \$576\.25 was processed in Shopify on August 7/i);
  assert.match(reply, /does not prove that your bank has posted the credit/i);
  assert.match(reply, /transaction reference/i);
  assert.doesNotMatch(reply, /one detail you want us to act on/i);
  assert.equal(draft.actions.some((action) => action.type === 'resolve'), false);
  assert.equal(draft.overall_confidence, 0.95);
});

test('historical exchange language does not block a current read-only status answer', () => {
  const draft = buildSafeReadOnlyOrderStatusDraft({
    subject: 'Order #1068 update',
    threadText: 'Last month the customer asked whether an exchange was possible. The current request is an ETA.',
    latestCustomerMessage: 'Can you tell me when order #1068 will ship?',
    customerName: 'Andrew Klein',
    supportContext: 'The current verified estimate is about another month.',
    orders: [order],
    signoffBlock: 'Support',
    responseState: 'awaiting_us',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  });
  assert.ok(draft);
  assert.match(String(draft.actions[0]?.params.reply_text), /Order #1068 has not shipped yet/);
});

test('quoted order-confirmation policy text does not block a current status or deadline answer', () => {
  const draft = buildSafeReadOnlyOrderStatusDraft({
    subject: 'Re: Order #1068 confirmed',
    threadText: 'Customer asks for a delivery update, followed by the original confirmation email.',
    latestCustomerMessage: [
      'Hi, is there any chance that I will get this order by 8/28?',
      '',
      'On Fri, Aug 14, 2026 at 3:44 PM Warm by Design <support@warmbydesign.com> wrote:',
      '> Order confirmation #1068',
      '> Return policy: contact us within 30 days for an exchange or replacement.',
    ].join('\n'),
    customerName: 'Jordan',
    supportContext: 'The current verified estimate is about another month.',
    orders: [order],
    signoffBlock: 'Support',
    responseState: 'awaiting_us',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  });
  assert.ok(draft);
  const reply = String(draft.actions[0]?.params.reply_text);
  assert.match(reply, /Order #1068 has not shipped yet/);
  assert.match(reply, /can't honestly promise delivery by 8\/28/i);
  assert.doesNotMatch(reply, /one detail you want us to act on/i);
});

test('a conditional refund status request gets an honest update and remains open for the decision', () => {
  const draft = buildSafeReadOnlyOrderStatusDraft({
    subject: 'Order #1057 update',
    threadText: 'Earlier the customer asked about an exchange.',
    latestCustomerMessage: "Can this ship in the next few weeks? If not, can I please request a refund?",
    customerName: 'Donna',
    supportContext: 'The current locked estimate is about another month.',
    orders: [{ ...order, id: 'gid://shopify/Order/1057', name: '#1057' }],
    signoffBlock: 'Support',
    responseState: 'awaiting_us',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  });
  assert.ok(draft);
  const reply = String(draft.actions[0]?.params.reply_text);
  assert.match(reply, /have not changed order #1057/i);
  assert.match(reply, /reply with your decision/i);
  assert.equal(draft.actions.some((action) => action.type === 'resolve'), false);
  assert.equal(draft.actions.some((action) => action.title === 'Tag: awaiting-customer'), true);
});

test('a disaster hardship request gets a compassionate minimum-information response', () => {
  const draft = buildSafeGoodwillSupportDraft({
    subject: 'Help replacing an Aven',
    latestCustomerMessage: 'Our home was destroyed in a house fire. Is there any goodwill support or a returned sample that could help replace our Aven lamp?',
    customerName: 'Anya Murphy',
    signoffBlock: 'Support',
    responseState: 'awaiting_us',
  });
  assert.ok(draft);
  const reply = String(draft.actions[0]?.params.reply_text);
  assert.match(reply, /so sorry about the fire/i);
  assert.match(reply, /either the original order number or the email address/i);
  assert.doesNotMatch(reply, /one detail you want us to act on/i);
  assert.equal(draft.actions.some((action) => action.type === 'resolve'), false);
});

test('supplied legacy PayPal recovery details are acknowledged without asking twice', () => {
  const draft = buildSafeLegacyRefundRecoveryDraft({
    subject: 'Order #4806',
    threadText: 'The original PayPal Express refund failed because the transaction was too old. Reply with the PayPal email, account name, and confirmation for an alternate payout.',
    latestCustomerMessage: 'PayPal email is chris@example.com. Account name Christopher Rodriguez. Account ending 0033. Please provide the ARN or trace ID.',
    customerName: 'Christopher Rodriguez',
    signoffBlock: 'Support',
    responseState: 'awaiting_us',
  });
  assert.ok(draft);
  const reply = String(draft.actions[0]?.params.reply_text);
  assert.match(reply, /will not need to send those again/i);
  assert.match(reply, /there is no valid ARN or bank trace number for that failed attempt/i);
  assert.doesNotMatch(reply, /send clear photos|one detail/i);
  assert.equal(draft.actions.some((action) => action.type === 'resolve'), false);
});

test('legacy refund status gets an honest draft without a payment promise', () => {
  const draft = buildSafeUnresolvedLegacyRefundDraft({
    subject: 'You owe me $461',
    threadText: "It's been 10 days and I am checking the status of my refund.",
    orders: [],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    responseState: 'awaiting_us',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  });
  assert.ok(draft);
  const reply = String(draft.actions[0]?.params.reply_text);
  assert.match(reply, /contain no successful refund transaction/);
  assert.doesNotMatch(reply, /will be processed|has been processed|was issued/i);
  assert.deepEqual(claimedCompletedMutationOutcomes(reply), []);
  assert.equal(draft.actions.some((action) => action.type === 'resolve'), false);
});

test('repairs an explicit refund cancellation into an executable dependent plan', () => {
  const draft = buildRepairedSupportDraft({
    draft: {
      summary: 'Refund the delayed order.',
      reasoning: 'The model omitted its actions.',
      overall_confidence: 0.8,
      actions: [],
    },
    subject: 'Order #1068',
    threadText: 'Please refund my order. I do not want it.',
    customerName: 'Kelly Catanzano',
    orders: [order],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    authorizedCancellationOrderIds: [order.id],
    authorizedRefundOrderIds: [order.id],
    authorizedRefundAmountByOrder: new Map([[order.id, null]]),
    readOnlyCrossBrandOrderIds: new Set(),
    rejection: 'empty_plan',
  });

  assert.equal(draft.actions[0]?.type, 'cancel_order');
  assert.equal(draft.actions.some((action) => action.type === 'refund_order'), false);
  const reply = draft.actions.find((action) => action.type === 'send_reply');
  assert.ok(reply);
  assert.match(String(reply.params.reply_text), /cancelled #1068 as requested/i);
  assert.deepEqual(reply.params.requires_action_types, ['cancel_order']);
  assert.equal(draft.actions.some((action) => action.type === 'resolve'), true);
  assert.ok(draft.overall_confidence >= 0.85);
});

test('a cancelled order with an outstanding paid balance gets a refund action, not another cancellation', () => {
  const cancelledPaidOrder: ShopifyOrderSummary = {
    ...order,
    id: 'gid://shopify/Order/1088',
    name: '#1088',
    totalPrice: '442.50',
    totalRefunded: 0,
    financialStatus: 'PAID',
    cancelledAt: '2026-08-12T08:02:53.000Z',
  };
  const draft = buildRepairedSupportDraft({
    draft: {
      summary: 'Follow up on the missing refund.',
      actions: [{
        type: 'send_reply',
        title: 'Old generic reply',
        detail: '',
        confidence: 0.5,
        params: { reply_text: 'Please give us one detail.' },
      }],
    },
    subject: 'Update for Order #1088',
    threadText: 'The customer asked to cancel. We confirmed cancellation, but the customer still has not received the refund.',
    latestCustomerMessage: "It has been a week and I haven't received the refund. Please provide an update ASAP.",
    customerName: 'Jeremy Belanger',
    orders: [cancelledPaidOrder],
    signoffBlock: 'Support',
    authorizedCancellationOrderIds: [],
    authorizedRefundOrderIds: [cancelledPaidOrder.id],
    authorizedRefundAmountByOrder: new Map([[cancelledPaidOrder.id, 442.5]]),
    readOnlyCrossBrandOrderIds: new Set(),
    rejection: 'provider unavailable',
  });

  assert.equal(draft.actions.some((action) => action.type === 'refund_order'), true);
  assert.equal(draft.actions.some((action) => action.type === 'cancel_order'), false);
  const reply = draft.actions.find((action) => action.type === 'send_reply');
  assert.ok(reply);
  assert.match(String(reply.params.reply_text), /issued the requested refund for #1088/i);
  assert.deepEqual(reply.params.requires_action_types, ['refund_order']);
  assert.deepEqual(
    claimedCompletedMutationOutcomes(String(reply.params.reply_text)),
    ['refund_order'],
  );
});

test('a rounded whole-order refund request cancels an unfulfilled order', () => {
  const roundedOrder = { ...order, totalPrice: '550.50' };
  const draft = buildRepairedSupportDraft({
    draft: {
      summary: 'Refund the order.',
      reasoning: 'The model omitted its actions.',
      actions: [],
    },
    subject: 'Order #1068',
    threadText: 'Please refund my order. Please refund me $550.',
    latestCustomerMessage: 'Please refund my order. Please refund me $550.',
    customerName: 'Suba Rohrman',
    orders: [roundedOrder],
    signoffBlock: 'Support',
    authorizedCancellationOrderIds: [],
    authorizedRefundOrderIds: [roundedOrder.id],
    authorizedRefundAmountByOrder: new Map([[roundedOrder.id, 550]]),
    readOnlyCrossBrandOrderIds: new Set(),
    rejection: 'empty plan',
  });
  assert.equal(draft.actions.some((action) => action.type === 'cancel_order'), true);
  assert.equal(draft.actions.some((action) => action.type === 'refund_order'), false);
  assert.match(String(draft.actions.find((action) => action.type === 'send_reply')?.params.reply_text), /cancelled/i);
});

test('repairs an apartment correction revision into an executable address update', () => {
  const authorizedText = [
    'I realized after I placed this order that I entered my apartment number wrong.',
    'The correct address for delivery and billing address is;',
    '16100 S Great Oaks Dr',
    'Apt # 2103',
    'Round Rock TX 78681',
    'Please let me know if you received this correction before the order ships.',
  ].join('\n');
  const draft = buildRepairedSupportDraft({
    draft: {
      summary: 'Prepare a grounded response from the latest request.',
      reasoning: 'The prior structured plan failed validation.',
      overall_confidence: 0.45,
      actions: [{
        type: 'send_reply',
        title: 'Reply about order #1068',
        detail: 'Ask what the customer wants.',
        confidence: 0.52,
        params: {
          reply_text: 'Hi Eric,\n\nPlease reply with the detail you want us to act on.\n\nSupport',
        },
      }],
    },
    subject: 'Wrong address on order',
    threadText: authorizedText,
    latestCustomerMessage: authorizedText,
    customerName: 'Eric Hall',
    orders: [order],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    authorizedCancellationOrderIds: [],
    authorizedRefundOrderIds: [],
    authorizedRefundAmountByOrder: new Map(),
    authorizedAddressTextByOrder: new Map([[order.id, authorizedText]]),
    readOnlyCrossBrandOrderIds: new Set(),
    rejection: 'reply claims completed update_shipping_address without a surviving verified action dependency',
    operatorInstruction: 'Reevaluate and draft again according to the customer request.',
  });

  const update = draft.actions.find((action) => action.type === 'update_shipping_address');
  assert.ok(update);
  assert.deepEqual(update.params.address, {
    address1: '16100 S Great Oaks Dr',
    address2: 'Apt # 2103',
    city: 'Round Rock',
    province: 'TX',
    zip: '78681',
  });
  const reply = draft.actions.find((action) => action.type === 'send_reply');
  assert.match(String(reply?.params.reply_text), /corrected the shipping address/i);
  assert.match(String(reply?.params.reply_text), /Apt # 2103/i);
  assert.doesNotMatch(String(reply?.params.reply_text), /detail you want us to act on/i);
  assert.deepEqual(reply?.params.requires_action_types, ['update_shipping_address']);
  assert.equal(draft.actions.some((action) => action.type === 'resolve'), true);
});

test('a reviewer cancellation replaces an existing refund and rewrites the reply', () => {
  const draft = buildRepairedSupportDraft({
    draft: {
      summary: 'Refund the delayed order.',
      reasoning: 'The earlier plan chose the wrong Shopify operation.',
      overall_confidence: 0.9,
      actions: [{
        type: 'refund_order',
        title: 'Refund order #1068',
        detail: 'Refund it.',
        confidence: 0.9,
        params: { order_id: order.id, order_name: order.name, amount: 185.45 },
      }, {
        type: 'send_reply',
        title: 'Reply about refund',
        detail: 'Confirm a refund.',
        confidence: 0.9,
        params: { reply_text: 'Hi Kelly,\n\nYour refund was issued.\n\nSupport' },
      }, {
        type: 'resolve',
        title: 'Resolve',
        detail: 'Close the ticket.',
        confidence: 0.9,
        params: {},
      }],
    },
    subject: 'Where is my order?',
    threadText: 'I want a refund. This is the third time I asked.',
    customerName: 'Jordan Marks',
    orders: [order],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    authorizedCancellationOrderIds: [order.id],
    authorizedRefundOrderIds: [order.id],
    authorizedRefundAmountByOrder: new Map([[order.id, null]]),
    readOnlyCrossBrandOrderIds: new Set(),
    rejection: 'reviewer_requires_cancellation',
    operatorInstruction: 'Cancel the order instead of just refunding it.',
  });

  assert.equal(draft.actions.filter((action) => action.type === 'cancel_order').length, 1);
  assert.equal(draft.actions.some((action) => action.type === 'refund_order'), false);
  const reply = draft.actions.find((action) => action.type === 'send_reply');
  assert.match(String(reply?.params.reply_text), /cancelled #1068/i);
  assert.match(String(reply?.params.reply_text), /will not continue to fulfillment/i);
  assert.match(String(reply?.params.reply_text), /ask us more than once/i);
  assert.deepEqual(reply?.params.requires_action_types, ['cancel_order']);
});

test('reviewer verified outcomes override an uncertain prior reply', () => {
  const draft = buildRepairedSupportDraft({
    draft: {
      summary: 'Say the refund cannot be verified.',
      reasoning: 'The earlier plan did not know the outcome.',
      overall_confidence: 0.8,
      actions: [{
        type: 'send_reply',
        title: 'Reply: refund unverified',
        detail: 'Keep it open.',
        confidence: 0.8,
        params: { reply_text: 'Hello,\n\nI cannot verify the refund.\n\nSupport' },
      }],
    },
    subject: 'You owe me $461',
    threadText: 'What is the status of my refund for order #1068?',
    customerName: 'Dan Perkins',
    orders: [order],
    signoffBlock: 'Support',
    authorizedCancellationOrderIds: [],
    authorizedRefundOrderIds: [],
    authorizedRefundAmountByOrder: new Map(),
    readOnlyCrossBrandOrderIds: new Set(),
    rejection: 'operator_verified_outcome',
    operatorInstruction: 'Refunded successfully; the prior issue was PayPal.',
    operatorVerifiedHistoricalOutcomes: [{
      type: 'refund_order',
      order_name: '#1068',
    }],
    keepTicketOpen: true,
  });

  const reply = draft.actions.find((action) => action.type === 'send_reply');
  assert.match(String(reply?.params.reply_text), /refund for #1068 was completed successfully/i);
  assert.doesNotMatch(String(reply?.params.reply_text), /cannot verify/i);
  assert.equal(draft.actions.some((action) => action.type === 'resolve'), false);
});

test('failed legacy refund revision replaces an impossible promise and complaint coercion', () => {
  const draft = buildRepairedSupportDraft({
    draft: {
      summary: 'Offer a new refund.',
      reasoning: 'The stale model draft chose an unsupported recovery route.',
      overall_confidence: 0.4,
      actions: [{
        type: 'send_reply',
        title: 'Reply',
        detail: 'Bad prior draft.',
        confidence: 0.4,
        params: {
          reply_text: 'Hi Chris,\n\nI can issue a new $501.75 refund to the original payment method. Please withdraw the CFPB complaint.\n\nSupport',
        },
      }, {
        type: 'refund_order',
        title: 'Refund legacy order',
        detail: 'Unsupported mutation.',
        confidence: 0.4,
        params: { order_id: order.id, order_name: order.name, amount: 501.75 },
      }, {
        type: 'resolve',
        title: 'Resolve',
        detail: 'Close it.',
        confidence: 0.4,
        params: {},
      }],
    },
    subject: 'Order #1068',
    threadText: 'The promised refund did not arrive.',
    customerName: 'Chris Rodriguez',
    orders: [order],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    authorizedCancellationOrderIds: [],
    authorizedRefundOrderIds: [],
    authorizedRefundAmountByOrder: new Map(),
    readOnlyCrossBrandOrderIds: new Set([order.id]),
    rejection: 'unsafe legacy refund promise',
    operatorInstruction: 'We have canceld the order, but the PayPal Express refund failed because the transaction expired. Ask for the PayPal email, displayed name, and confirmation it can receive $418.30 USD.',
    operatorVerifiedPendingRefund: {
      amount: 418.3,
      originalRefundFailed: true,
      collectPayPalDetails: true,
      cancellationCompleted: true,
      source: 'operator_revision',
    },
  });

  const reply = String(draft.actions.find((action) => action.type === 'send_reply')?.params.reply_text);
  assert.match(reply, /cancelled/);
  assert.match(reply, /original refund did not go through/);
  assert.match(reply, /\$418\.30 USD/);
  assert.match(reply, /email address connected to the PayPal account/);
  assert.doesNotMatch(reply, /\$501\.75|original payment method|withdraw|CFPB/i);
  assert.equal(draft.actions.some((action) => action.type === 'refund_order'), false);
  assert.equal(draft.actions.some((action) => action.type === 'resolve'), false);
});

test('repairs an order-specific exchange reply by inserting the verified order number', () => {
  const draft = buildRepairedSupportDraft({
    draft: {
      summary: 'Discuss an exchange.',
      reasoning: 'Answer the latest question.',
      overall_confidence: 0.9,
      actions: [{
        type: 'send_reply',
        title: 'Reply about exchange',
        detail: 'Discuss available alternatives.',
        confidence: 0.9,
        params: {
          reply_text: 'Hi Andrew,\n\nYes, we can discuss switching to another lamp.\n\nSupport',
          requires_action_types: [],
        },
      }],
    },
    subject: 'Order #1068',
    threadText: 'Can I exchange it for a lamp that is in stock?',
    customerName: 'Andrew Klein',
    orders: [order],
    signoffBlock: 'Support',
    authorizedCancellationOrderIds: [],
    authorizedRefundOrderIds: [],
    authorizedRefundAmountByOrder: new Map(),
    readOnlyCrossBrandOrderIds: new Set(),
    rejection: 'order-specific reply does not identify any verified live order number',
  });

  const reply = draft.actions.find((action) => action.type === 'send_reply');
  assert.match(String(reply?.params.reply_text), /order #1068/i);
  assert.equal(draft.actions.some((action) => action.type === 'cancel_order'), false);
  assert.ok(Number(reply?.confidence) <= 0.72);
});

test('fallback intent follows the latest customer message instead of an old damaged-item subject', () => {
  const draft = buildRepairedSupportDraft({
    draft: {
      summary: 'Prepare a grounded response.',
      reasoning: 'DeepSeek planning was unavailable (http_error).',
      overall_confidence: 0.45,
      actions: [],
    },
    subject: 'Order #1068 - damaged lamp and box',
    threadText: [
      '[Customer] My lamp arrived damaged. Please refund it.',
      '[Agent] We reached out and asked that the refund be processed.',
      '[Customer] I really appreciate the communication. Thank you.',
    ].join('\n\n'),
    latestCustomerMessage: 'I really appreciate the communication. Thank you.',
    customerName: 'Chris Cunnington',
    orders: [order],
    signoffBlock: 'Support',
    authorizedCancellationOrderIds: [],
    authorizedRefundOrderIds: [],
    authorizedRefundAmountByOrder: new Map(),
    readOnlyCrossBrandOrderIds: new Set([order.id]),
    rejection: 'provider unavailable',
  });

  const reply = draft.actions.find((action) => action.type === 'send_reply');
  assert.doesNotMatch(String(reply?.params.reply_text), /send clear photos|damaged area/i);
  assert.equal(
    draft.actions.some((action) => (
      action.type === 'add_tags'
      && Array.isArray(action.params.tags)
      && action.params.tags.includes('validation-repaired')
    )),
    false,
  );
  assert.doesNotMatch(draft.reasoning, /http_error|validator result|deterministic repair/i);
});

test('a post-refund restock request gets a real reply and never repeats the old mutation', () => {
  const refundedOrder = {
    ...order,
    name: '#1085',
    financialStatus: 'REFUNDED',
    lineItems: [{ title: 'Vine Floor Lamp', quantity: 1, variantTitle: null }],
  };
  const draft = buildSafeRestockInterestDraft({
    subject: 'Order #1085 - Status Request',
    threadText: [
      '[Customer] Please refund my delayed order #1085.',
      '[Agent] Your order was cancelled and refunded.',
      '[Customer] Please let me know when these are back in stock and I will reorder.',
    ].join('\n\n'),
    latestCustomerMessage: 'Please let me know when these are back in stock and I will reorder.',
    customerName: 'Kelly Catanzano',
    orders: [refundedOrder],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    responseState: 'awaiting_us',
  });

  assert.ok(draft);
  const reply = String(draft.actions.find((action) => action.type === 'send_reply')?.params.reply_text);
  assert.match(reply, /reorder Vine Floor Lamp when it is available again/i);
  assert.match(reply, /don't have a verified restock date/i);
  assert.doesNotMatch(reply, /refund|cancelled|exchange/i);
  assert.equal(draft.actions.some((action) => action.type === 'cancel_order'), false);
  assert.equal(draft.actions.some((action) => action.type === 'refund_order'), false);
  assert.equal(draft.actions.some((action) => action.type === 'resolve'), true);
  assert.equal(draft.actions.some((action) => (
    action.type === 'add_tags'
    && Array.isArray(action.params.tags)
    && action.params.tags.includes('restock-interest')
  )), true);
});

test('legacy planner recovery tags are never preserved as customer work', () => {
  const draft = buildRepairedSupportDraft({
    draft: {
      summary: 'Prepare a grounded response.',
      reasoning: 'The prior provider failed.',
      overall_confidence: 0.4,
      actions: [{
        type: 'add_tags',
        title: 'Tag: planner-retry-needed',
        detail: 'Old internal recovery marker.',
        confidence: 0.4,
        params: { tags: ['planner-retry-needed'] },
      }],
    },
    subject: 'Order #1024',
    threadText: 'Please inspect both pieces carefully before shipping.',
    latestCustomerMessage: 'Please inspect both pieces carefully before shipping.',
    customerName: 'Bhanu Jain',
    orders: [
      order,
      { ...order, id: 'gid://shopify/Order/1084', name: '#1084' },
    ],
    signoffBlock: 'Support',
    authorizedCancellationOrderIds: [],
    authorizedRefundOrderIds: [],
    authorizedRefundAmountByOrder: new Map(),
    readOnlyCrossBrandOrderIds: new Set(),
    rejection: 'prior internal fallback',
  });

  assert.equal(draft.actions.some((action) => (
    action.type === 'add_tags'
    && Array.isArray(action.params.tags)
    && action.params.tags.includes('planner-retry-needed')
  )), false);
  assert.equal(draft.actions.some((action) => action.type === 'send_reply'), true);
});

test('confirms a verified charged order instead of requesting a missing confirmation', () => {
  const draft = buildSafeLatestCustomerRequestDraft({
    subject: 'No receipt and no delivery information',
    threadText: 'I see a charge for $243.75 but never received a receipt or confirmation.',
    latestCustomerMessage: 'I see a charge for $243.75 but never received a receipt or confirmation. Is it legitimate?',
    customerName: 'Terry Johnson',
    supportContext: 'Current realistic fulfillment delay is about another four weeks.',
    orders: [{ ...order, name: '#1317', totalPrice: '243.75' }],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    responseState: 'unanswered',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  });
  assert.ok(draft);
  const reply = String(draft.actions.find((action) => action.type === 'send_reply')?.params.reply_text);
  assert.match(reply, /matched it to order #1317/i);
  assert.match(reply, /purchase is legitimate/i);
  assert.doesNotMatch(reply, /send the order number/i);
  assert.equal(draft.overall_confidence, 0.94);
});

test('does not ask for an order number the charged customer never received', () => {
  const draft = buildSafeLatestCustomerRequestDraft({
    subject: 'Charged for lamp — no order confirmation',
    threadText: 'I already sent my name, phone, billing ZIP, and purchase date.',
    latestCustomerMessage: 'The charge fully posted but I never received a confirmation, receipt, or order number.',
    customerName: 'Justin Weber',
    supportContext: '',
    orders: [],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    responseState: 'unanswered',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  });
  assert.ok(draft);
  const reply = String(draft.actions.find((action) => action.type === 'send_reply')?.params.reply_text);
  assert.match(reply, /won't ask you for an order number/i);
  assert.match(reply, /last four digits/i);
  assert.match(reply, /merchant descriptor/i);
  assert.ok(!draft.actions.some((action) => action.type === 'resolve'));
});

test('answers a product color question without requesting an order number', () => {
  const draft = buildSafeLatestCustomerRequestDraft({
    subject: 'marigold orange color',
    threadText: '',
    latestCustomerMessage: 'Will orange be replenished? Is yellow brighter? I want soft ambient light.',
    customerName: 'Jinah Jung',
    supportContext: 'Warm by Design products use warm 2700K ambient light.',
    orders: [],
    signoffBlock: 'Best Regards,\nWarm by Design Customer Support Team',
    responseState: 'unanswered',
    authorizedCancellationCount: 0,
    authorizedRefundCount: 0,
    authorizedAddressChangeCount: 0,
  });
  assert.ok(draft);
  const reply = String(draft.actions.find((action) => action.type === 'send_reply')?.params.reply_text);
  assert.match(reply, /2700K/i);
  assert.match(reply, /don't have a confirmed date/i);
  assert.doesNotMatch(reply, /order number/i);
});

type SafeActionType = NonNullable<
  ReturnType<typeof buildSafeReadOnlyOrderStatusDraft>
>['actions'][number]['type'];
