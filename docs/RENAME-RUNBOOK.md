# Rename → `supportOS`: Infra & Repo Runbook

The **code/branding** rename is done (admin UI wordmark, README, root `package.json`,
page titles). The steps below are **dashboard operations** that must be done by you and
sequenced to avoid downtime. Do them in this order. None are required for the app to keep
working under the old infra names — they're cosmetic/identity, so there's no rush and no
forced outage if you pause between steps.

> Golden rule: **rename one thing, verify the app still works, then move on.** Don't change
> env-var *names* and infra names in the same deploy.

## 1. GitHub repository (safe — GitHub auto-redirects)
- Repo → Settings → rename `shopify-ai-chatbot` → `supportos`.
- GitHub keeps all stars/issues/PRs and **redirects the old URL**, so existing
  Railway/Vercel git integrations keep working via the redirect.
- Update your local remote: `git remote set-url origin https://github.com/<you>/supportos.git`.
- Verify: `git fetch` succeeds.

## 2. Vercel project (admin console)
- Vercel → Project → Settings → General → rename project to `supportos-admin`.
- The Git connection follows the GitHub redirect; if Vercel shows the repo as disconnected,
  reconnect it to the renamed repo.
- Custom domain (if any) is unaffected by a project-name change.
- Verify: trigger a redeploy; the admin loads and shows the **supportOS** wordmark.

## 3. Railway project/service (backend)
- Railway → Project → Settings → rename project to `supportos` and the service to
  `supportos-backend`.
- **The public URL contains the service name** (`...-production-9ab4.up.railway.app`). If the
  generated domain changes, you must update every place that hard-codes the old URL:
  - `scripts/support-email-webhook.gs` → `WEBHOOK_URL`
  - any Shopify webhook subscriptions pointing at the backend
  - `CORS_ORIGIN` / widget script `src` URLs if they reference it
  - Prefer attaching a **stable custom domain** (e.g. `api.supportos.app`) now so future
    renames never break integrations again.
- Verify: `curl https://<new-or-custom-domain>/health` returns `{"status":"ok"}`.

## 4. Shopify app (Dev Dashboard) — optional, cosmetic
- Partners/Dev Dashboard → your app → rename display name to `supportOS`.
- **Do NOT** regenerate `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` — a rename keeps them.
- Verify: backend still mints a token (any order lookup works).

## 5. Environment-variable prefixes — LAST, one at a time
Brand-scoped vars use slug-derived suffixes (`RESEND_API_KEY_<SLUG>`,
`EMAIL_FROM_ADDRESS_<SLUG>`) read in `brand-email-config.service.ts`. These key off **brand
slugs**, not the product name — so renaming the product to supportOS does **not** require
changing them. Only touch them if you also rename a *brand* slug, and if so:
1. Add the new-named var alongside the old (both present).
2. Deploy, verify email send/receive for that brand.
3. Remove the old var.

## Rollback
Every step above is individually reversible (rename back). Because the GitHub redirect and
unchanged secrets keep integrations alive, a half-finished rename never bricks production —
the worst case is a stale hard-coded URL, fixed by editing the few files listed in step 3.
