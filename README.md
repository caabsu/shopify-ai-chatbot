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
