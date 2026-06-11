# supportOS

**supportOS** is a multi-brand customer-experience platform for Shopify brands — AI chat,
ticketing/helpdesk, returns & RMA automation, product reviews, order tracking, and a trade
program — operated from one dashboard with per-brand theming and data separation.

> Formerly "Shopify AI Customer Support Chatbot." Renaming infra/repo to `supportos` is a
> staged migration — see [docs/RENAME-RUNBOOK.md](docs/RENAME-RUNBOOK.md).

## Architecture

- **Backend** — Node.js + Express + TypeScript. Orchestrates Claude AI conversations,
  integrates with Shopify Admin API and Storefront MCP, stores data in Supabase. Multi-brand
  (Outlight, Warm by Design, Misu) with brand-scoped queries. Deployed on Railway.
- **Admin (supportOS console)** — Next.js 15 / React 19, unified design-system tokens with
  per-brand accent theming. Deployed on Vercel.
- **Widgets** — Vanilla JS/CSS bundles (chatbot, returns portal, contact form, reviews,
  tracking) embedded on each storefront.

## Autopilot (AI action-recommendation inbox)

Every incoming ticket for an enabled brand is analyzed automatically at email-sync time —
no manual trigger. A planner pipeline on the backend (context gathering → Claude planner
with a strict action schema → deterministic validators) proposes an **action plan**:
close-as-non-support, a fully drafted reply grounded in the KB / locked support facts /
the customer's live Shopify orders, order cancellation, refund, shipping-address change,
priority/tags, or escalate-to-human. Every action carries a calibrated **confidence score**.

Plans land in the **Autopilot** review queue in the console (`/autopilot`): read the AI's
analysis, expand and edit the drafted reply, toggle individual actions, then **Approve &
run** — execution happens server-side with live re-validation against Shopify (an order
that got fulfilled since planning will refuse to cancel). Nothing ever runs without
approval. Dismissals, per-action results, and full audit events are recorded on the ticket.

- Enabled brands: `AUTOPILOT_BRANDS` env on the backend (default `warm-by-design`).
  Scaling to another brand is adding its slug.
- Triggers: new email ticket, new contact-form ticket, customer reply (re-plans), plus a
  5-minute sweep as backstop. Non-support email gets a no-LLM fast-path close card.
- Storage: `tickets.metadata.autopilot` (see docs/migrations/011 for the future table).
- Safety: planner can only reference orders fetched from Shopify for that customer;
  Shopify mutations are validated twice (at planning and again at execution).

## Ticketing (helpdesk v2)

The ticket system is a full helpdesk: email/contact-form/AI-escalation intake, AI triage,
agent workflows, SLA tracking, and a CSAT loop.

**Intake & sync**
- Inbound: Gmail Apps Script forwarder → `/api/webhooks/email` (rate-limited, secret-gated,
  idempotent by RFC Message-ID, brand-routed by recipient). Auto-replies (out-of-office)
  don't trigger confirmations.
- Outbound: agent replies send via Resend **and BCC the brand support inbox**, so Gmail
  keeps a threaded record of everything sent from the console. Failed sends are flagged on
  the message and surfaced to the agent ("Email failed" badge) instead of silently passing.
  Historical replies can be restored into Gmail with
  `node scripts/restore-sent-replies-to-gmail.mjs` (idempotent).

**AI**
- Auto-triage on intake (Haiku): intent, sentiment, language, one-line summary, suggested
  tags, suggested priority. Default-priority tickets the model flags urgent/high are
  escalated automatically (SLA recalculated). Shown as chips in the inbox + detail view.
- Spam/promo classification at the door (only ≥0.95-confidence spam is dropped); reviewable
  "AI Clean Up" bulk action for the rest.
- Agent tools: draft reply (with Shopify customer/order/KB context + agent instructions),
  summarize thread, suggest next steps.

**Agent workflow**
- Assignment (roster dropdown, "Assign to me", Mine view, per-agent filter, avatar chips)
- Snooze with presets — snoozed tickets leave the queue and wake automatically (5-min
  sweeper) or instantly when the customer replies
- Merge duplicate tickets from the same customer (messages move, source closes with audit)
- Saved views (filter combos as one-click chips), keyboard shortcuts (`?` for the cheatsheet:
  J/K navigate, R reply, N note, E resolve, A assign-to-me, S snooze)
- Shopify sidebar: customer LTV/orders, expandable order detail, cancel order, issue refund
- SLA: deadlines per priority, breach sweeper runs every 5 minutes, queue sorts by urgency

**CSAT loop**
- On resolve, the customer gets a one-click 1–5 rating email (HMAC-signed links →
  `GET /api/csat` on the backend). Scores appear on tickets, in the inbox, and as an
  average in the stats row. Disable per brand with `brands.settings.csat_enabled = false`.

**Security**
- Inbound webhook fails closed without `EMAIL_WEBHOOK_SECRET` in production
- Rate limits on the webhook, contact forms, and agent login; admin login lockout
  (8 fails / 15 min); JWT secret fails closed in production

Schema note: v2 fields (snooze/merge/CSAT/triage) live in `tickets.metadata` today;
[docs/migrations/010-ticket-helpdesk-v2.sql](docs/migrations/010-ticket-helpdesk-v2.sql)
promotes them to real columns + adds performance indexes when applied (optional, code
works either way).

## Setup

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in credentials
3. `npm install` from the root
4. `npm run dev:backend` to start the backend
5. `npm run dev:widget` to start the widget dev server

## Environment Variables

See `.env.example` for the full list.

## Deployment

- Backend deploys to Railway
- Widget JS/CSS served as static assets from the backend
- Add `<script src="https://YOUR-RAILWAY-DOMAIN/widget/widget.js" defer></script>` to Shopify theme

## Monitoring

Support tickets reach the system via three channels — **Google** (Gmail Apps Script →
`/api/webhooks/email`, see [scripts/support-email-webhook.gs](scripts/support-email-webhook.gs)),
the **contact form** (`/api/tickets/form`), and **AI escalation** (`/api/tickets/escalate`).
A silent stall in any of them is easy to miss (Outlight's email inflow once died ~3 weeks
unnoticed), so run the inflow health check:

```bash
npm run health:inflow            # per-brand last-ticket age, source mix, inbox config
STALE_HOURS=24 npm run health:inflow
```

It exits non-zero if any enabled brand has had no ticket within `STALE_HOURS` (default 48),
so it can drive an alert. Schedule it (cron / GitHub Action / Railway cron) to catch stalls
early. Reads Supabase creds from `apps/backend/.env`.
