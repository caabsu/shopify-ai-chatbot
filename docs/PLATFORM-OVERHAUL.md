# Platform Overhaul — Audit, Fix Report & Staged Plan

_Last updated: 2026-05-28_

This document captures (1) the root-cause + fix for the "Outlight tickets not flowing
in" incident, (2) a full architectural audit of the platform, and (3) a staged plan for
the production-grade rebrand + UI overhaul + backend hardening.

---

## Part 1 — Incident: Outlight tickets stopped flowing (FIXED)

### Symptom
New tickets for **Outlight** stopped appearing in the dashboard.

### Evidence (live production DB, 2026-05-28)
| Brand | Total tickets | Last ticket | Dominant source |
|---|---|---|---|
| **Outlight** | 746 | **2026-05-11** (#2962) | `email` (~98%) |
| Warm by Design | 41 | **2026-05-28** (#3003) — healthy | `email` |
| Misu | 22 | 2026-05-05 | `email` (no support_email configured) |

Outlight email inflow died on **May 11**; Warm kept flowing. Outlight's brand row is
`enabled`, has `support_email`/`inbound_email = support@outlight.us`, and the webhook
correctly resolves `support@outlight.us → Outlight` (verified by simulating
`resolveBrandIdByEmailRecipient` against the live DB). So the **backend was never the
problem.**

### Root cause
Inbound support email reaches the backend via **Gmail → Google Apps Script →
`POST /api/webhooks/email`**. The repo's only Apps Script (`warm-support-email-webhook.gs`)
is **hardcoded to `warm-by-design` / `support@warmbydesign.com`**. There is **no Outlight
forwarder** — the single Gmail automation was effectively repurposed to Warm during the
mid-May Warm launch, so `support@outlight.us` is no longer polled/forwarded. (Corroborated
by the Gmail OAuth integration now returning `deleted_client`.)

### Secondary bug — AI classifier ("ai sync")
`classifyEmail()` ran `JSON.parse(text.trim())`, but Haiku returns ` ```json `-fenced
output, so it threw on **every** email and silently fell back to
`customer_support / confidence = 0`. That's why every recent ticket shows `(0)` and why
obvious promotional/spam mail (e.g. TikTok-Shop ads) became "customer_support" tickets.
Classification was effectively a no-op.

### Fixes shipped (commit `a0bf640`, backend → Railway)
1. **`scripts/support-email-webhook.gs`** — new **multi-brand** Gmail forwarder. Polls
   every brand inbox in one pass, routes by `?brand=<slug>`, idempotent (backend dedupes
   by RFC `Message-ID`), and has a configurable `BACKFILL_DAYS` for catch-up. Add a brand
   by appending one line to `BRANDS` — no backend change.
2. **`email-classifier.service.ts`** — robust JSON extraction (strips code fences / prose,
   validates the category enum). Classification now actually works.
3. **`inbound-email.service.ts`** — conservative intake: only drop unambiguous
   high-confidence **spam** (≥0.95). Real tickets are never silently discarded; accurate
   classification is recorded for the dashboard's reviewable "auto-close non-support".

### Required user action (cannot be automated — lives in your Google account)
The Outlight inbox is fixed the moment the Gmail script is updated:

1. Open the **existing** Apps Script project that already forwards Warm email
   (it ran today → it's alive and holds `EMAIL_WEBHOOK_SECRET` + a working trigger).
2. Replace its code with `scripts/support-email-webhook.gs`.
3. **Backfill** the May 11→now Outlight gap: Project Settings → Script properties →
   set `BACKFILL_DAYS = 21`, run `processSupportEmails` once manually, then set it back
   to `7` (or delete the property).
4. Confirm the time-driven trigger calls `processSupportEmails` (rename from
   `processWarmSupportEmails` if needed).

> If `support@outlight.us` and `support@warmbydesign.com` deliver into **different** Google
> accounts, deploy a copy of the script in each with only that brand in `BRANDS`.

### Follow-ups (not blocking)
- Configure **Misu** `support_email` so its inbound email routes (currently 422s).
- The inbound webhook's secret is *optional* server-side (`verifyEmailWebhookSecret`
  returns `true` when unset). Make it **required in production**.
- Consider migrating inbound email from Gmail Apps Script to a provider inbound-parse
  webhook (Resend/Postmark) for reliability — removes the Google-account dependency.

---

## Part 2 — Architectural Audit

### What the platform actually is
Far past a "chatbot." It's a **multi-brand customer-experience OS for Shopify brands**:
AI chat, ticketing/helpdesk, returns/RMA portal + label/refund automation, product
reviews, order tracking, a trade program, and a quiz funnel — backend (Express/Railway),
admin dashboard (Next.js 15/React 19/Vercel), and two Vite widget bundles
(`apps/widget` = Outlight/Misu, `apps/widget-warm` = Warm).

### Backend findings
- **B1 — Brand resolution defaults silently.** `resolveBrandId()` falls back to a
  hardcoded Outlight UUID. Good for storefront widgets, dangerous for write paths — a
  mis-routed request silently lands in Outlight. Webhooks correctly use the
  non-defaulting `resolveOptionalBrandId`. Keep that split explicit and audited.
- **B2 — Type duplication.** ~40 interfaces duplicated between
  `apps/backend/src/types` and `apps/admin/src/lib/types.ts`. No shared package → drift.
- **B3 — No HTTP client abstraction.** Admin pages call `fetch()` ad hoc; API contract is
  implicit; no generated client, no central error/auth handling.
- **B4 — `index.ts` is ~2,400 lines.** Mixes route wiring, giant inline HTML preview/
  playground templates, and cron bootstrapping. Hard to navigate; preview HTML belongs in
  templates/static.
- **B5 — Open inbound webhook** when secret unset (see Part 1 follow-ups).
- **B6 — In-memory brand cache** (5-min TTL) per instance — fine now; needs a documented
  invalidation story before horizontal scaling.
- **Good:** clean service-layer separation, brand-scoped queries, graceful degradation
  (`loadSupportContext`), idempotent email dedup, per-brand Resend config resolution.

### Frontend findings (the overhaul target)
- **F1 — Scattered color definitions (critical for rebrand).** Semantic colors are
  redefined per page (`TAG_COLORS`, `PRIORITY_STYLES`, `STATUS_STYLES`,
  `CLASSIFICATION_STYLES`, activity `TYPE_CONFIG`, reviews `#C4A265`, …) in 15+ files,
  plus `globals.css`, plus widget CSS. A global rebrand currently means editing 20+ files.
- **F2 — ~3,209 inline `style={{}}` blocks** across 76 pages. No shared primitives
  (Badge/Button/Card/Table/Modal) → inconsistent spacing, radii, shadows, states.
- **F3 — Only ~8 shared components**; most UI logic + styling lives inline in pages.
- **F4 — Multi-brand theming is not token-driven.** `BrandContext` carries brand identity,
  but admin theme tokens are static in `globals.css`; widgets hardcode per-brand palettes
  (`--aicb-gold #C5A059` vs `--wbd-accent #F5BC70`). Adding a brand means forking CSS.
- **F5 — Widget CSS sprawl.** ~6,377 lines across `apps/widget` + `apps/widget-warm`, with
  duplicated buttons/typography/animation and many separate Vite configs.

### Top 5 problems to fix in the overhaul
1. One **design-token source of truth** (color/space/type/radii/shadow/motion) with
   **per-brand accent theming** driven by data, consumed by admin **and** widgets.
2. A small **shared primitive library** (Button, Badge/StatusPill, Card, Table, Modal,
   Input, Tabs, Toast) to delete the inline-style sprawl.
3. **Brand theming from the DB** (`brands.settings.theme`) → CSS variables at load, so a
   4th brand is config, not a fork.
4. **Shared `@types` package** + a typed **API client** (one base URL, auth, errors).
5. **Widget consolidation** onto the shared token layer; collapse redundant Vite configs.

---

## Part 3 — Rebrand + UI Overhaul (staged)

### Product name (proposal)
The platform unifies many brands' support under one roof and the flagship brands are
lighting/home (Outlight, Warm by Design). A name evoking **guiding light + support**:

- **Beacon** _(recommended)_ — a guiding light; "Beacon — the support OS for your brands."
- **Lumen** — unit of light; clean, modern, SaaS-friendly.
- **Hearth** — warmth + home + a place people gather for help.

> Rename scope: apply the new name to **product branding** (admin UI, README, docs, login).
> Do **not** churn infra identifiers (Railway/Vercel project names, repo, env var names,
> Shopify app) in the same pass — those are separate, higher-risk migrations.

### Design language (direction)
Clean, calm, content-first, slightly editorial; generous whitespace; one accent that
**re-themes per brand**; semantic status colors; subtle depth (borders + soft shadows over
heavy gradients); fast, legible tables; confident primary CTAs with clear hierarchy
(primary / secondary / ghost / destructive). Light + dark, AA contrast.

### Execution stages
- **Stage 0 — Design system foundation** ✅ DONE: `globals.css` token layer
  (color/space/type/radii/shadow/motion) + per-brand accent theming via `[data-brand]`
  (wired in `brand-context`). Component classes `.ds-pill` / `.ds-btn` / `.ds-card`.
- **Stage 1 — Shared primitives** ✅ (core) `components/ui/StatusPill` + `Button`.
  StatusPill is the single source of truth for status taxonomies — kinds: `status`,
  `priority`, `source`, `classification`, `return`, `review`, `trade`. (Card/Table/Modal/
  Toast/Input still to add as pages need them.)
- **Stage 2 — Shell + rebrand** ✅ DONE: sidebar, nav, login, titles, README, package →
  **supportOS**.
- **Stage 3 — Page migration** 🔄 IN PROGRESS: ✅ tickets, ✅ returns, ✅ reviews,
  ✅ trade/applications. 🔲 remaining: tracking/insights, trade/members(+[id]),
  trade/applications/[id], chatbot/conversations, reviews/products, reviews/analytics,
  returns/[id], tickets/[id], insights, settings/*.
- **Stage 4 — Brand theming from DB**: read `brands.settings.theme` → inject the
  `[data-brand]` CSS vars from data (today the per-brand accents are hardcoded in
  globals.css); brand switcher then live-reskins.
- **Stage 5 — Widget unification**: move widgets onto the shared token layer; consolidate
  Vite configs; shared base CSS.
- **Stage 6 — Backend hardening**: shared `@types` package, typed API client, split
  `index.ts` preview HTML into templates, require webhook secret in prod, Misu inbox.

### Migration recipe (per page — now mechanical)
1. Delete the page's local `*_STYLES` / `TAG_COLORS` color object(s).
2. `import { StatusPill } from '@/components/ui/StatusPill'` (and `Button` if it has
   action buttons). Replace status/badge spans with `<StatusPill kind=… value=… />`
   (add a new `kind` to StatusPill's `TOKENS` if the taxonomy is new).
3. Replace hardcoded `#hex` / `rgba()` with token vars (`var(--color-*)`, `var(--text-*)`,
   `var(--bg-*)`); wrap list containers in `.ds-card`.
4. `npx tsc --noEmit` then `npx next build`; commit per batch.

### Decisions needed to execute the bulk (owner: you)
1. **Product name** — Beacon / Lumen / Hearth / other?
2. **Priority order** — which module's UI to rebuild first (tickets is the daily driver).
3. **Rename depth** — product branding only (safe), or also infra/repo (riskier, separate).
