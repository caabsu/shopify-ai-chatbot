# Skio Subscription Integration — Architecture & Capabilities

## What is Skio?

Skio is a Shopify subscription management platform. It uses Shopify's native subscription APIs and checkout extensions. Subscriptions in Skio map 1:1 to Shopify `SubscriptionContract` objects (the `platformId` in Skio is the Shopify GID, e.g. `gid://shopify/SubscriptionContract/12346616394`).

---

## Authentication

- **API Key**: Generated in Skio dashboard → Accounts → API
- **Auth method**: `Authorization` header (case-sensitive) with the API key
- **Endpoint**: GraphQL API at `https://api.skio.com/graphql` (confirm exact URL in dashboard)
- **Rate limit**: 2,000 requests/min per token
- **Query limits**: Max depth 4 levels, max 100 nodes per request
- **Webhooks**: Configurable in Accounts → API → Webhooks tab

### Environment Variables Needed
```
SKIO_API_KEY=sk_...
SKIO_API_URL=https://api.skio.com/graphql
```

---

## Available API Operations

### Queries
| Query | Description |
|-------|-------------|
| `subscriptions` | List subscriptions, filter by customer email, status, etc. |
| `subscription` | Get single subscription by ID |
| `customer` | Get customer with their subscriptions |

### Mutations
| Mutation | Description |
|----------|-------------|
| `cancelSubscription` | Cancel a subscription + Shopify SubscriptionContract |
| `pauseSubscription` | Pause (temporarily stop billing) |
| `unpauseSubscription` | Resume a paused subscription |
| `skipSubscription` | Skip the next billing cycle, returns next billing date |
| `reactivateSubscription` | Reactivate a cancelled subscription |
| `subscriptionEditInterval` | Change billing/delivery frequency |
| `subscriptionUpdatePaymentMethod` | Update payment method |
| `swapSubscriptionProductVariants` | Swap product variants (size, flavor, etc.) |
| `addSubscriptionLine` | Add a product (recurring or one-time) |
| `updateSubscriptionLineBulk` | Update multiple line items at once |
| `removeProductVariantFromSellingPlanGroup` | Remove product from selling plan |
| `updateSubscriptionNote` | Update notes on a subscription |
| `setDeliveryPriceOverride` | Override shipping price |
| `updateDynamicBoxSubscription` | Update dynamic/build-a-box subscriptions |
| `generateMagicLink` | Generate passwordless login link for customer portal |

### Webhooks (outbound from Skio)
| Event | Use Case |
|-------|----------|
| Subscription created | Sync new subscriptions |
| Subscription cancelled | Update customer status, trigger win-back |
| Subscription paused | Track churn risk |
| Order created | Track recurring orders |
| Payment failed | Trigger dunning/support ticket |

---

## Integration Architecture

### 1. Backend Service Layer

New file: `apps/backend/src/services/skio.service.ts`

```
skio.service.ts
├── getSubscriptionsByEmail(email) — look up all subscriptions for a customer
├── getSubscription(id) — get subscription details
├── cancelSubscription(id) — cancel
├── pauseSubscription(id) — pause
├── unpauseSubscription(id) — resume
├── skipSubscription(id) — skip next order
├── updateFrequency(id, interval) — change delivery frequency
├── swapProduct(id, oldVariantId, newVariantId) — swap product
├── addProduct(id, variantId, quantity) — add product to subscription
├── generatePortalLink(email) — magic link for customer self-service
```

### 2. AI Chatbot Tools (new tools for the AI)

| Tool | Description | When AI Uses It |
|------|-------------|-----------------|
| `lookup_subscription` | Look up subscriptions by customer email | "What's the status of my subscription?" |
| `pause_subscription` | Pause a subscription | "I want to pause my subscription" |
| `unpause_subscription` | Resume a paused subscription | "I want to restart my subscription" |
| `skip_next_order` | Skip the next billing cycle | "Can I skip next month?" |
| `cancel_subscription` | Cancel (with retention flow first) | "I want to cancel" |
| `update_subscription_frequency` | Change delivery interval | "Can I switch to every 2 months?" |
| `swap_subscription_product` | Swap variant | "Can I switch to a different size?" |

**Important — Retention flow for cancellations:**
Before the AI calls `cancel_subscription`, it should:
1. Ask why the customer wants to cancel
2. Offer alternatives based on reason:
   - Too much product → skip or reduce frequency
   - Too expensive → (no discount, but acknowledge)
   - Didn't like it → offer swap or pause
   - Temporary → suggest pause instead
3. Only cancel after the customer confirms they still want to

### 3. Support Hub — Agent Dashboard

#### Ticket Context Panel (right sidebar on ticket detail)

When viewing a ticket, if the customer has an active subscription:

```
┌─ Subscription ──────────────────────┐
│ Status: Active                      │
│ Plan: Monthly — $49/mo              │
│ Next billing: Mar 25, 2026          │
│ Started: Jan 10, 2026               │
│ Orders: 3                           │
│                                     │
│ [Pause]  [Skip]  [Cancel]           │
│ [Change Frequency]  [View in Skio]  │
└─────────────────────────────────────┘
```

All actions executable directly from the ticket without leaving the dashboard.

#### Dedicated Subscriptions Page (sidebar: Support → Subscriptions)

| View | Shows |
|------|-------|
| Active | All active subscriptions |
| Paused | Paused subscriptions (churn risk) |
| Cancelled | Recently cancelled (win-back candidates) |
| Payment Failed | Failed billing (needs attention) |

Each row: customer name, email, plan, status, next billing date, total orders, LTV.

Click into detail view: full subscription history, order history, payment history, actions.

#### Ticket Quick Actions (existing panel, new actions)

| Action | What It Does |
|--------|-------------|
| Pause Subscription | Pauses via Skio API |
| Skip Next Order | Skips next billing cycle |
| Cancel Subscription | Cancels via Skio API |
| Change Frequency | Modal to select new interval |
| Send Portal Link | Emails customer a magic link to self-manage |

### 4. Webhook Receiver

New endpoint: `POST /api/webhooks/skio`

Receives Skio webhook events and:
- **Subscription cancelled**: Auto-create ticket tagged `churn` + `cancellation` for win-back outreach
- **Payment failed**: Auto-create ticket tagged `payment_failed`, priority high
- **Subscription paused**: Log event, optionally create ticket for follow-up

### 5. AI Insights on Tickets

When a ticket involves a subscription customer, the AI context includes:
- Subscription status, plan, frequency
- How many orders they've placed
- Customer lifetime value
- Whether they've paused/skipped before
- Payment failure history

This powers smarter AI draft replies and agent context:
> "This customer has been subscribed for 3 months ($133 LTV). They paused once in February. Their next billing is in 5 days."

---

## Customer-Facing Capabilities

### Via AI Chatbot
- "What's my subscription status?" → looks up by email
- "Skip my next order" → confirms and skips
- "Pause my subscription" → asks duration preference, pauses
- "Cancel my subscription" → retention flow → cancel if confirmed
- "Change to every 2 months" → updates frequency

### Via Customer Portal (Skio native)
- Generate magic link via API → email to customer
- Customer manages everything self-service in Skio's portal
- Can be triggered from chatbot: "Here's a link to manage your subscription directly"

---

## Database Additions

No new tables strictly needed — subscription data lives in Skio/Shopify. But optionally:

```
subscription_events (for tracking actions taken through our system)
├── id (uuid, PK)
├── brand_id (uuid)
├── subscription_id (text) — Skio subscription ID
├── customer_email (text)
├── event_type (text) — cancelled, paused, skipped, frequency_changed, etc.
├── actor (text) — ai_chatbot, agent, webhook, customer
├── actor_id (text, nullable)
├── details (jsonb)
├── created_at (timestamptz)
```

---

## File Structure

```
apps/backend/src/
├── services/
│   └── skio.service.ts              — Skio GraphQL client + all operations
├── controllers/
│   └── skio.controller.ts           — Webhook receiver

apps/admin/src/
├── app/(dashboard)/
│   └── subscriptions/
│       ├── page.tsx                  — subscriptions list
│       └── [id]/page.tsx            — subscription detail
├── app/api/
│   └── subscriptions/
│       ├── route.ts                 — proxy to backend Skio queries
│       └── [id]/
│           └── actions/route.ts     — pause, skip, cancel, etc.
```

---

## Integration with Existing Systems

| System | Connection |
|--------|-----------|
| **Tickets** | Subscription context shown on ticket sidebar; subscription actions in Quick Actions |
| **AI Chatbot** | New tools for lookup, pause, skip, cancel, frequency change |
| **Email** | Confirmation emails for subscription changes made via support |
| **Insights** | Churn rate, subscription health, MRR tracking |
| **Webhooks** | Auto-ticket creation on cancellation/payment failure |

---

## Build Order

1. Skio service layer (GraphQL client + all mutations/queries)
2. AI chatbot tools (lookup, pause, skip, cancel with retention flow)
3. Ticket sidebar integration (show subscription context + actions)
4. Webhook receiver (auto-tickets for cancellations, payment failures)
5. Dedicated subscriptions page in dashboard
6. Insights integration (churn metrics, MRR)

---

## Sources

- [Skio API Reference](https://code.skio.com/)
- [Using the Skio API](https://help.skio.com/docs/using-the-skio-api)
- [Skio Subscription Management](https://help.skio.com/docs/subscription-management)
- [Skio Cancel Flow Dashboard](https://help.skio.com/docs/cancel-flow-dashboard)
- [Skio Pausing Subscriptions](https://help.skio.com/docs/pausing-subscriptions)
- [Skio API Keys & Webhooks](https://help.skio.com/docs/api)
