# Customer 360 Profile — Implementation Plan

## Overview

A unified customer view that aggregates data from every system (Shopify, Skio, Supabase) into a single profile page. Agents see the full customer story in one place. The AI uses this context for smarter responses. Accessible from any ticket, conversation, or via direct search.

---

## 1. Data Sources & What We Pull

### Shopify Admin API
| Data | API | Notes |
|------|-----|-------|
| Customer record | `customer` query by email | Name, email, phone, address, tags, created date, accepts marketing |
| Order history | `orders` query filtered by customer | Order #, date, status, fulfillment, total, items, tracking |
| Total spent / order count | `customer.ordersCount`, `customer.totalSpent` | Lifetime value |
| Refund history | Embedded in order data | Which orders had refunds, amounts |
| Notes & tags | `customer.note`, `customer.tags` | Internal notes from Shopify admin |

### Skio API
| Data | API | Notes |
|------|-----|-------|
| Active subscriptions | `subscriptions` query by email | Plan, frequency, status, next billing date |
| Subscription history | Subscription timeline | Start date, pauses, skips, frequency changes, cancellations |
| Payment failures | From subscription events | Dunning history |
| Customer portal link | `generateMagicLink` | Quick link to send customer |

### Supabase (Internal)
| Data | Table | Notes |
|------|-------|-------|
| All tickets | `tickets` filtered by email | Every ticket with status, source, resolution |
| AI conversations | `conversations` + `messages` filtered by email | Full chat transcripts |
| Return requests | `return_requests` filtered by email | Return history (when returns portal is built) |
| Subscription events | `subscription_events` filtered by email | Actions taken through our system |
| CSAT scores | `conversations.satisfaction_score` | Average satisfaction |

---

## 2. Customer Profile Data Model

Assembled at request time (not stored — always fresh from source):

```typescript
interface Customer360 {
  // Identity
  email: string;
  name: string | null;
  phone: string | null;
  address: ShopifyAddress | null;
  shopifyCustomerId: string | null;
  createdAt: string; // when they first appeared in any system
  tags: string[];
  notes: string | null;

  // Value metrics
  lifetimeValue: number; // total spent in Shopify
  totalOrders: number;
  averageOrderValue: number;
  subscriptionMonths: number; // how long subscribed
  estimatedLTV: number; // projected based on subscription

  // Health signals
  healthScore: 'healthy' | 'at_risk' | 'churned';
  riskFactors: string[]; // e.g. ["paused subscription", "recent complaint", "payment failed"]

  // Shopify
  orders: ShopifyOrder[];

  // Skio
  subscriptions: SkioSubscription[];

  // Support
  tickets: Ticket[];
  conversations: Conversation[];
  returnRequests: ReturnRequest[]; // future

  // Timeline
  timeline: TimelineEvent[]; // unified chronological feed
}

interface TimelineEvent {
  id: string;
  type: 'order' | 'ticket' | 'conversation' | 'subscription_change' | 'return' | 'email' | 'note';
  title: string;
  description: string;
  date: string;
  metadata: Record<string, unknown>;
  link?: string; // link to detail page
}
```

---

## 3. UI Design

### Entry Points

1. **Ticket detail sidebar** — "View full profile" link on customer card
2. **Conversation detail** — Customer email links to profile
3. **Global search** — Search bar in header, type email or name → customer profile
4. **Sidebar nav** — New item under Support: "Customers"

### Profile Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Tickets                                              │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  [Avatar]  Hee Su Chung                                   │   │
│  │            caabsu123@gmail.com · +1 (555) 123-4567        │   │
│  │            Customer since Jan 2026 · Seoul, South Korea   │   │
│  │                                                            │   │
│  │  Tags: [subscriber] [vip]              [Send Portal Link] │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐  │
│  │  $182   │ │    4    │ │ $45.50  │ │ Active  │ │  ● 92   │  │
│  │  LTV    │ │ Orders  │ │  AOV    │ │ 3 mos   │ │ Health  │  │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘  │
│                                                                  │
│  ┌─ Tabs ──────────────────────────────────────────────────┐    │
│  │ [Timeline]  [Orders]  [Subscription]  [Tickets]  [Chat] │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Timeline tab (default):                                         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ● Mar 10  Ticket #1008 opened — "Order never arrived"   │   │
│  │  ● Mar 10  AI chat — 6 messages, escalated               │   │
│  │  ● Mar 1   Order #1004 — $49.00, Fulfilled, Delivered    │   │
│  │  ● Feb 15  Subscription paused (customer request)         │   │
│  │  ● Feb 1   Order #1003 — $49.00, Fulfilled, Delivered    │   │
│  │  ● Jan 10  Subscription started — Monthly, $49/mo        │   │
│  │  ● Jan 10  Order #1001 — $35.00, Fulfilled, Delivered    │   │
│  │            (Welcome bundle included)                       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Orders tab:                                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  #1004  Mar 1   $49.00  Delivered  ✓  [View in Shopify]  │   │
│  │  #1003  Feb 1   $49.00  Delivered  ✓                      │   │
│  │  #1001  Jan 10  $35.00  Delivered  ✓  (Welcome bundle)   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Subscription tab:                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Status: Active                                            │   │
│  │  Plan: Monthly — $49/mo                                    │   │
│  │  Next billing: Mar 25, 2026                                │   │
│  │  Started: Jan 10, 2026 (3 months)                          │   │
│  │  Total orders: 4                                            │   │
│  │  History: Started → Paused (Feb 15) → Resumed (Feb 20)    │   │
│  │                                                            │   │
│  │  [Pause] [Skip Next] [Cancel] [Send Portal Link]          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Tickets tab:                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  #1008  Order never arrived     Open     AI Escalation    │   │
│  │  #1002  General inquiry          Closed   Form             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Health Score Calculation

```
Start at 100, subtract:
  - Subscription cancelled: -100 (churned)
  - Subscription paused: -25
  - Payment failed (unresolved): -30
  - Open complaint ticket: -15
  - Return request in last 30 days: -10
  - No order in 45+ days (non-subscription): -20
  - CSAT score < 3: -15

Thresholds:
  - 70-100: Healthy (green)
  - 40-69: At Risk (amber)
  - 0-39: Churned / Critical (red)
```

Risk factors shown as tags: `paused subscription`, `recent complaint`, `payment failed`, etc.

---

## 4. Ticket Sidebar Integration

The existing customer card on the ticket detail page gets enhanced:

```
┌─ Customer ──────────────────────────┐
│  [HC]  Hee Su Chung                 │
│        caabsu123@gmail.com          │
│                                      │
│  LTV: $182 · 4 orders · 3 mos      │
│  Subscription: Active, $49/mo       │
│  Health: ● Healthy                   │
│                                      │
│  [View Full Profile]                 │
└──────────────────────────────────────┘
```

This replaces the current minimal customer card. Key metrics are visible at a glance without leaving the ticket.

---

## 5. AI Context Injection

When the AI chatbot or AI ticket tools run, the Customer 360 data is injected into the system context:

```
CUSTOMER CONTEXT:
- Name: Hee Su Chung
- Email: caabsu123@gmail.com
- Customer since: Jan 2026
- LTV: $182 across 4 orders
- Subscription: Active, Monthly $49/mo, next billing Mar 25
- History: Paused once in February
- Open tickets: #1008 (order never arrived)
- Health: Healthy (score 85)
```

This enables:
- AI draft replies that reference order history ("I can see your last order #1004 was delivered on March 1st...")
- Smarter escalation summaries with full context
- AI "Summarize Customer" tool for agents

---

## 6. Customers List Page

New page: `/customers` — searchable, filterable list of all customers who've interacted with support.

| Column | Source |
|--------|--------|
| Name | Shopify / ticket data |
| Email | All sources |
| LTV | Shopify |
| Subscription | Skio |
| Health | Calculated |
| Last Contact | Latest ticket or conversation |
| Open Tickets | Count |

Filters: health score, subscription status (active/paused/cancelled/none), has open ticket, LTV range.

Click any row → full Customer 360 profile.

---

## 7. Backend Architecture

### API Endpoints

```
GET /api/customers?search=&health=&subscription_status=&page=
  → Paginated customer list with metrics

GET /api/customers/:email/profile
  → Full Customer 360 data (aggregated from all sources)

GET /api/customers/:email/timeline?page=
  → Paginated unified timeline

GET /api/customers/:email/orders
  → Shopify order history

GET /api/customers/:email/subscriptions
  → Skio subscription data

POST /api/customers/:email/actions
  → Execute actions (pause subscription, send portal link, add tag, add note)
```

### Service Layer

```
apps/backend/src/services/
└── customer360.service.ts
    ├── getCustomerProfile(email, brandId) — aggregates all sources
    ├── getCustomerTimeline(email, brandId, page) — unified timeline
    ├── getCustomerOrders(email, brandId) — Shopify orders
    ├── getCustomerSubscriptions(email, brandId) — Skio data
    ├── calculateHealthScore(profile) — health algorithm
    ├── getCustomerList(filters, brandId, page) — search + list
    └── buildAIContext(email, brandId) — formatted context for AI
```

### Caching Strategy

Customer profiles are expensive (3+ API calls). Cache in memory with 5-minute TTL:

```
Profile requested → check cache
  → Cache hit + fresh: return immediately
  → Cache miss or stale: fetch from all sources in parallel
    → Shopify customer + orders (1 API call)
    → Skio subscriptions (1 API call)
    → Supabase tickets + conversations (1-2 queries)
  → Assemble profile, cache, return
```

For the ticket sidebar (lightweight version), cache just the summary metrics — no full order/ticket lists.

---

## 8. Admin Dashboard Pages

### File Structure

```
apps/admin/src/app/(dashboard)/
├── customers/
│   ├── page.tsx                — customer list with search + filters
│   └── [email]/
│       └── page.tsx            — full Customer 360 profile
├── app/api/
│   └── customers/
│       ├── route.ts            — list endpoint (proxies to backend)
│       └── [email]/
│           ├── route.ts        — profile endpoint
│           ├── timeline/route.ts
│           └── actions/route.ts
```

### Sidebar Navigation Update

```
Support
  ├── Ticket Inbox
  ├── Customers        ← new
  └── Insights
```

---

## 9. Global Search

Header search bar enhanced to search across:
- Customer names and emails
- Ticket subjects and numbers
- Order numbers

Results grouped by type:

```
┌─ Search: "caabsu" ──────────────────┐
│                                      │
│  Customers                           │
│    Hee Su Chung — caabsu123@gmail   │
│                                      │
│  Tickets                             │
│    #1008 — Order never arrived       │
│    #1006 — the only way              │
│                                      │
│  Orders                              │
│    #1004 — $49.00, Mar 1             │
└──────────────────────────────────────┘
```

---

## 10. Build Order

1. **Backend service** — `customer360.service.ts` with profile aggregation, health score, caching
2. **Profile API endpoints** — `/api/customers/:email/profile`, `/timeline`, etc.
3. **Profile page** — Full Customer 360 UI with tabs (Timeline, Orders, Subscription, Tickets, Chat)
4. **Ticket sidebar upgrade** — Enhanced customer card with key metrics + "View Full Profile" link
5. **Customers list page** — Searchable/filterable list
6. **AI context injection** — Feed customer data into chatbot and ticket AI tools
7. **Global search** — Header search across customers, tickets, orders
8. **Skio integration** — Subscription tab with live data + actions (after Skio service is built)

---

## 11. Dependencies

| Dependency | Status |
|------------|--------|
| Shopify Admin API | Ready (auth service exists) |
| Supabase (tickets, conversations) | Ready |
| Skio API | Needs API key + service (see skio-subscription-integration.md) |
| Returns data | Needs returns portal (see returns-portal-architecture.md) |

The profile works without Skio/returns — those tabs just show "Not connected" or "No data" until those integrations are built. Core value (orders + tickets + conversations + health score) works immediately.
