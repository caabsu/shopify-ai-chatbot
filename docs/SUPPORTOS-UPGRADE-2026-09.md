# SupportOS upgrade — September 2026

## September 16 owner-authorized execution update

The earlier rollout notes below are historical. AI Gateway credits were added and
DeepSeek V4.1 Flash / V4 Pro are working. The owner authorized the current Warm by
Design queue at an effective confidence of at least 70%, followed by a complete
audit and rewrite of lower-confidence proposals. Execution also requires current
order evidence, customer authorization, independent quality checks and durable
provider receipts; scores are not increased to satisfy the threshold.

Current locked policy: no shipping to Hawaii; the September 16 baseline is about
three weeks **until shipment**, with the exact shipping date unconfirmed. First
cancellation requests receive an apology and a choice of continued delivery with
a 30% total refund or cancellation with the outstanding payment returned. Prior
partial refunds count toward the 30% total. Actual automatic money/order actions
still require a subsequent explicit choice on the exact order after a verified
sent offer. Existing shipment, refund and cancellation facts take precedence over
the pending-shipment estimate.

The live Vercel executor is handling the authorized stored-ticket batch. No
duplicate sends were found in the first 54 verified outbound replies. Human work
such as failed refunds, unapproved price adjustments and legacy returns remains
open even when an explanatory reply is sent. The ongoing Railway backend is
still unavailable and unattended automation remains paused. This run does not
establish that unimported emails in the Warm support mailbox have been synced.

Operational evidence and the final run report are saved under the ignored
`output/supportos-owner-70/` directory. It contains private customer data and must
not be committed or published.

The admin was deployed to production on September 16, 2026, and migration
`20260916000021_support_automation.sql` was applied to the live database. Automation
settings were enabled only for Warm by Design. Existing unrelated workspace edits
were preserved. No customer email, refund, or cancellation was triggered during rollout.

Live admin: https://shopify-ai-chatbot-admin.vercel.app/support

The Railway backend deployment is blocked because its trial has expired. The AI
Gateway balance is exhausted, so the requested bulk DeepSeek audit/rewrite has not run.
Production API checks passed for the inbox (191 open/pending tickets), settings,
scheduled/completed views, usage reporting, and retired Funnel/Trade routes. The
background worker has no heartbeat yet. This is a partial rollout, not a working
end-to-end automation deployment.

## Workspace

- New shared sidebar, light/dark themes, responsive navigation and consistent page frame.
- `/overview`: live support counts and latest conversations.
- `/support`: inbox, scheduled queue, auto-completed history and manual review.
- Conversation, decision/evidence and action timeline panes; sent replies, timestamps,
  generation metadata, quality checks and provider receipts remain inspectable.
- Inline manual replies and notes, durable takeover, delivery-pending handling, and
  protection against sending a draft after new customer activity without reviewing it.
- Full manual ticket workstation retains assignment, tags, snooze, order tools, knowledge,
  canned responses and keyboard navigation. Inbox maintenance controls are grouped.
- `/support/settings`: pause/resume the worker policy, thresholds, confirmed-cancellation
  and retention-refund switches, live Gateway balance and worker heartbeat.
- Funnel and Trade admin pages/APIs are retired; old page URLs redirect to Support.
  Historical database records are retained.

## Decisions and timing

Routine inference uses `deepseek/deepseek-v4.1-flash`. Higher-impact planning and verification
use `deepseek/deepseek-v4-pro`. The native Flash alias is `deepseek-flash`. Production remains
on Vercel AI Gateway with no cross-model-family fallback.

Independent verification checks factual grounding, the latest customer request, policy,
authorization, and unsupported ETA claims. All five checks must be present exactly once,
with passing results and evidence. Confidence cannot exceed the weakest action or verifier.
The displayed score is a decision threshold, not a measured probability of correctness.
We have not measured the proportion of real emails that will qualify: live model validation
is currently blocked by insufficient Gateway credits.

Each eligible new plan is stored once with a random 15–30 minute due time. The default
thresholds are 90% for replies and 95% for order mutations. Jobs freeze the exact plan,
revision, context version and fingerprint. Activation excludes old backlog drafts.
Two workers cannot claim the same job. New customer activity, manual takeover, changed
rules, stale/mismatched evidence, or changed Shopify state stop outdated execution.
The existing provider receipt ledger and customer/order scope locks protect external actions.
Unknown outcomes are held for reconciliation; interrupted mutations are never automatically
replayed. Each tick executes at most one due plan and persists its outcome.

## Cancellation and retention policy

1. A first eligible cancellation request receives an apology and two explicit choices:
   keep delivery with a 30% refund, or cancel with a refund of the outstanding payment.
2. The offer is tagged by the server on the successfully sent public agent message.
3. Only a later explicit customer choice for that same order authorizes automatic action.
   Bare “yes,” questions, conditions, contradictions, quoted old replies, and mismatched
   order numbers remain in review. Offers expire for confirmation after 14 days.
4. Cancellation is automatic only for the verified eligible unfulfilled, untracked order.
   Shopify cancellation/refund success is checked before the confirmation email.
5. The keep option refunds the remaining portion of the 30% concession, rounded to cents.
   Prior refunds count toward that total; a retry does not add another 30%.

No owner approval is required for a qualifying customer-confirmed action. A manually held
ticket stays in manual care; an operator can continue through the individual plan review.
Sensitive disputes, requests for a person, ambiguous instructions and unsupported actions
stay in review.

## Live access findings

The model was verified in the live AI Gateway catalog and the official announcement:
https://vercel.com/changelog/deepseek-v4-1-flash-now-available-on-ai-gateway

The existing Gateway account has been topped up by the owner. Live structured-tool probes
passed for V4.1 Flash and V4 Pro; no replacement API key is needed. On September 16 at
09:29 UTC, the Gateway balance was approximately $13.40 after probes, the historical
audit, drafting and recovery runs. Model/provider pricing may vary; the catalog baseline
at inspection was $0.15/M input tokens and $0.60/M output tokens for V4.1 Flash.

The linked Railway backend had no active deployment at inspection. Its deployment
attempt was rejected with "Your trial has expired. Please select a plan to continue
using Railway." The existing Gateway credential is configured in the live admin and
backend environments; both also have the worker secret and exact model settings.

Official pricing checked September 16: direct V4.1 Flash costs $0.15/M uncached input
and $0.60/M output off-peak, doubling during its published peak windows. Gateway lists
DeepInfra at $0.20/M input and $0.60/M output, and Fireworks at $0.22/M and $0.66/M.
Gateway adds no inference markup. Existing cost sorting and the no-training filter
were retained; no provider billing account was opened and no credits were purchased.
Sources: https://api-docs.deepseek.com/quick_start/pricing/ and
https://vercel.com/ai-gateway/models/deepseek-v4.1-flash

DeepSeek V4.1 audited all 517 stored Warm by Design tickets. Review of the source messages
confirmed 29 classification corrections and nine closed cases requiring follow-up.
Those nine were reopened with internal audit notes and manual-review/automation-hold
tags and persisted holds. Ten confirmed non-support cases were closed without replies.
Two older cancellation attempts with uncertain receipts (#3447 and #3361) were separately
held for provider reconciliation, with their original plans preserved. Previous replies,
plans and execution receipts were preserved. The inbox now has 190 open/pending tickets;
completed history remains available. The backlog refresh and bounded recovery passes are
complete. All 517 stored tickets have a completed V4.1 audit. There are 185 fresh proposed
plans: 79 AI-generated plans, 88 already-answered/awaiting-customer plans, 14 non-support
classification plans and four conservative fallbacks after repeated model failures. Of the
79 AI plans, 52 passed independent verification and 27 remain in review. Three completed
historical plans and the two uncertain cancellation runs were preserved. No customer email
or Shopify mutation was executed by the audit. All 287 tests and the release builds pass.

Missing mailbox emails have not yet been reconciled. The available connected Gmail
accounts do not include the Warm support mailbox, and Railway still rejects deployment
because the trial has expired. Automatic sending is temporarily paused until mailbox
reconciliation and a healthy worker are verified. The redesigned Vercel admin is live at
https://shopify-ai-chatbot-admin.vercel.app/support and its authenticated APIs pass smoke
checks. Funnel redirects to Support; Trade APIs return 410.

The Apps Script forwarder now checkpoints individual message IDs instead of excluding
whole processed Gmail conversations. It includes a paginated full-backfill entry point,
preserves cursor/checkpoint state on failures, and serializes overlapping triggers. The
updated script still needs installation in the Warm support mailbox's Apps Script project.

Live model testing also led to larger reasoning budgets for Pro, a timeout that includes
response-body reading, and one bounded quality-correction pass. Verification receives the
same customer identity/history as planning and explicitly applies the owner's current
30% retention policy over older compensation rules. Dated shipping estimates must stay
anchored to their original update rather than silently restarting from today. The safe
draft fallback no longer rewrites a one-month source estimate into two weeks. Retention
drafts can include independently verified answers to additional customer questions while
preserving the mandatory offer and later-confirmation requirement.

## Rollout

1. Gateway top-up and live Flash/Pro model probes are complete.
2. Verify existing ticket-context, generation-ledger and scope-lock migrations, then apply
   `supabase/migrations/20260916000021_support_automation.sql`. It adds settings, holds,
   delayed jobs, an inbox view and an atomic service-role-only claim function. New settings
   activate only plans generated after installation.
3. Build/deploy the admin from the repository root with the admin root directory configured
   and outside-root source included. Shared pure policy modules live in the backend source;
   a legacy archive containing only `apps/admin` is insufficient.
4. Set `AUTOPILOT_FLASH_MODEL=deepseek/deepseek-v4.1-flash`,
   `AUTOPILOT_PRO_MODEL=deepseek/deepseek-v4-pro`, `AUTOPILOT_AI_PROVIDER=vercel-ai-gateway`
   and the existing Gateway credential in both runtimes.
5. Generate one 32+ character `SUPPORT_AUTOMATION_SECRET` and configure it in both runtimes.
   Set `SUPPORT_AUTOMATION_ADMIN_URL` on Railway to the canonical deployed admin HTTPS URL.
   Do not use a redirecting hostname. Deploy/restart a healthy backend.
6. Verify the worker heartbeat in Automation rules, new-plan quality results, queue due
   times, receipts and email delivery on an explicitly designated test ticket/order before
   measuring production coverage. Existing drafts need regeneration under the new policy.

The worker POST endpoint performs constant-time secret authentication and never accepts
an operator identity from the request. Scheduled work does not depend on an open browser.
Pause in Automation rules to stop new claims; running work checks before each new provider
operation. A request already accepted by a provider can finish and must be reconciled.

## Verification and local preview

`npm test`, `npm run build:backend`, and `npm run build:admin` validate the change. New tests
cover retention confirmation, exact concession math, malformed independent checks, weakest
confidence, stale contexts, delayed claims, concurrent workers, holds, brand isolation and
service-role/RLS boundaries. Database tests run the migration in PGlite/Postgres.

Browser checks used the real read-only inbox on desktop/mobile and in both themes.
Intercepted sample responses exercised completed history, sent-reply receipts, takeover,
pending delivery and new-message review while preserving a composed reply. Samples exist
only in ignored verification artifacts; application code has no seeded demonstration data.

`node scripts/supportos-preview.mjs` starts a read-only local preview on port 3002 using
the ignored admin production environment snapshot. Its isolated `.next-preview` build
does not conflict with a production build. Local browser auth, backups, archived retired
modules, screenshots and test logs are under ignored `output/supportos-upgrade/`.
