# Returns Portal — System Architecture

## Overview

A complete returns system with three surfaces: **customer-facing portal** (embedded widget), **agent dashboard** (in Support Hub), and **AI decision engine** (automated processing). All backed by Shopify's native return system.

---

## 1. Customer-Facing Returns Portal

**Embedded widget** (`/widget/returns.js`) — same pattern as chat widget and contact form.

**Flow:**
```
Customer enters order # + email
        ↓
Backend verifies identity via Shopify Admin API
        ↓
Shows eligible items (from Shopify returnableFulfillments query)
        ↓
Customer selects items, quantity, reason, uploads photos
        ↓
Submits return request → saved to DB + Shopify returnCreate
        ↓
Confirmation email sent, ticket created in Support Hub
```

**Screens:**
1. **Lookup** — Order number + email (identity verification)
2. **Item Selection** — Shows returnable items with images, prices, quantities. Each item gets a checkbox + quantity selector
3. **Reason & Details** — Per-item return reason (dropdown: defective, wrong item, changed mind, doesn't fit, other) + optional text + photo upload
4. **Review & Submit** — Summary of selections before submitting
5. **Confirmation** — Return request ID, next steps, timeline

---

## 2. Database Schema

### return_requests
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| brand_id | uuid | FK → brands |
| ticket_id | uuid, nullable | FK → tickets |
| order_id | text | Shopify order GID |
| order_number | text | Display number (#1042) |
| customer_email | text | |
| customer_name | text, nullable | |
| status | enum | pending_review, approved, partially_approved, denied, shipped, received, refunded, closed, cancelled |
| shopify_return_id | text, nullable | Shopify return GID after approval |
| ai_recommendation | jsonb | { decision, confidence, reasoning } |
| resolution_type | enum, nullable | refund, exchange, store_credit |
| refund_amount | decimal, nullable | |
| admin_notes | text, nullable | |
| decided_by | uuid, nullable | FK → agents |
| decided_at | timestamptz, nullable | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| metadata | jsonb | |

### return_items
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| return_request_id | uuid | FK → return_requests |
| line_item_id | text | Shopify line item GID |
| fulfillment_line_item_id | text | Shopify fulfillment line item GID |
| product_title | text | |
| variant_title | text, nullable | |
| product_image_url | text, nullable | |
| quantity | integer | |
| price | decimal | |
| reason | enum | defective, wrong_item, changed_mind, doesnt_fit, not_as_described, other |
| reason_details | text, nullable | |
| photo_urls | text[], nullable | |
| item_status | enum | pending, approved, denied |
| denial_reason | text, nullable | |
| created_at | timestamptz | |

### return_rules
| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| brand_id | uuid | FK → brands |
| name | text | |
| enabled | boolean | |
| priority | integer | Rule evaluation order |
| conditions | jsonb | e.g. { "order_age_days": "<30", "reason": "defective", "amount": "<50" } |
| action | enum | auto_approve, auto_deny, flag_review, ai_review |
| resolution_type | enum, nullable | refund, exchange, store_credit |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

## 3. AI Decision Engine

When a return request comes in, before agent review:

```
Collect context:
  - Order data (date, total, items, fulfillment status)
  - Customer history (past returns, total orders, lifetime value)
  - Return reason + details + photos
  - Brand return policy (from knowledge base)
        ↓
Run configurable rules first (auto-approve/deny if matched)
        ↓
If no rule matched → AI review via Claude:
  - System prompt with return policy, brand guidelines
  - All context above
  - Output: { decision: approve|deny|needs_review, confidence: 0-1, reasoning: "..." }
        ↓
If confidence > threshold (configurable, e.g. 0.85) → auto-execute
If confidence < threshold → flag for human review with AI recommendation
```

**AI capabilities:**
- Photo analysis (if photos uploaded — Claude vision)
- Policy compliance check
- Fraud detection signals (excessive returns, pattern matching)
- Suggested resolution type (refund vs store credit based on reason)

---

## 4. Agent Dashboard (Support Hub)

**Returns page** — new sidebar item under Support

**Views:**
- **Pending Review** — needs human decision (with AI recommendation shown)
- **Approved** — awaiting customer shipment
- **In Transit** — customer shipped back
- **Received** — item received, pending refund
- **Completed** — refunded/exchanged/credited
- **Denied** — with denial reason

**Per-return detail view:**
- Order summary (pulled from Shopify)
- Items being returned with reasons + photos
- AI recommendation with confidence score + reasoning
- Customer history sidebar (past orders, past returns)
- Action buttons: **Approve**, **Partially Approve**, **Deny**, **Request More Info**
- On approve: select resolution (refund / store credit / exchange), triggers Shopify `returnApproveRequest`
- On refund: triggers Shopify `returnRefund` mutation
- Notes + internal timeline

**Settings page (under Settings → Returns):**
- Return window (days)
- Eligible/ineligible product tags or collections
- Auto-approval rules builder (drag-and-drop conditions)
- AI confidence threshold slider
- Resolution defaults per reason
- Email templates for each status change

---

## 5. Shopify Native Integration

| Action | Shopify Mutation/Query |
|--------|----------------------|
| Check eligibility | `returnableFulfillments` query on order |
| Create return | `returnCreate` mutation |
| Approve return | `returnApproveRequest` mutation |
| Decline return | `returnDeclineRequest` mutation |
| Process refund | `refundCreate` mutation |
| Get return status | `return` query |
| Generate shipping label | `returnShippingLabel` (if configured) |

All returns exist natively in Shopify admin — agents can also view them there.

---

## 6. Email Notifications

| Event | Email to Customer |
|-------|------------------|
| Request submitted | Confirmation + return request # |
| Approved | Instructions (ship item back, label if applicable) |
| Partially approved | Which items approved/denied + reasons |
| Denied | Reason + appeal option |
| Item received | Confirmation, refund processing |
| Refund issued | Amount + method + timeline |

---

## 7. File Structure

```
apps/backend/src/
├── services/
│   ├── return.service.ts          — CRUD, status transitions
│   ├── return-rules.service.ts    — rule evaluation engine
│   └── return-ai.service.ts       — AI decision calls
├── controllers/
│   └── return.controller.ts       — API routes

apps/admin/src/app/(dashboard)/
├── returns/
│   ├── page.tsx                   — returns inbox (like tickets)
│   └── [id]/page.tsx             — return detail + actions
├── settings/
│   └── returns/page.tsx          — return rules + config

apps/widget/src/
└── returns-portal.ts             — customer-facing embedded form
```

---

## 8. Required Shopify Scopes

Already available: `write_returns`, `read_orders`, `read_fulfillments`, `read_products`, `read_customers`.

---

## 9. Build Order

1. DB tables + return service
2. Customer portal widget (lookup → select → submit)
3. Agent dashboard (list + detail + approve/deny actions)
4. Shopify native integration (returnCreate, approve, refund)
5. Rule engine + settings UI
6. AI decision engine
7. Email notifications at each step
8. Photo upload support
