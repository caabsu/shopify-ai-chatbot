# September restoration and Jev integration — 2026-09-22

The canonical `main` source was restored from Vercel deployment
`dpl_7aheJXrFJa76FFGUCgW6xYNeqxjy` (September 16). Its 566 uploaded source files
were recovered and SHA-1 verified; generated output was excluded. The original
local Jev work and existing edits were preserved in a Git stash and a separate
local backup. The restored baseline is commit `52b0236`.

DeepSeek V4.1 Flash and V4 Pro remain the support writers/planners. Jev 1.13.0
performs bounded intake classification, intent/sentiment/priority, three draft
quality scores, and six defect probabilities. Active Jev replaces generative
intake/triage calls when its response validates; uncertainty stays in support.
The existing independent DeepSeek factual/policy/authorization verifier remains.
A Jev failure can veto approval; it cannot authorize refunds, manufacture facts,
or increase the planner's confidence. Acknowledgement skipping additionally
requires Jev to find no remaining obligation, supplied information, or attachment.

`JEV_MODE` is off/shadow/active. `JEV_BRAND_IDS` explicitly scopes the rollout.
`SUPPORT_AUTOMATION_BRAND_IDS` scopes all worker reads and writes, including
interrupted jobs. The current rollout is Warm by Design only. The existing
90%/95% unattended settings are separate from an owner-authorized manual 70%
review pass; a one-time pass does not enable unattended sending.

Assessments are cached by brand, ticket, model, rubric, exact text and source
context in ticket events. Provider attempts also use the existing append-only
`ai_generation_runs` ledger, with estimated Jev cost identified as such. Cache
hits do not incur or record another paid call. Threshold execution checks that
the passed Jev assessment matches the exact reply text. Changes require a fresh
assessment. Human-reviewed composer sends retain the existing idempotency,
context-version, Shopify evidence, generation-lineage and provider-receipt checks.

The v3 rubric accounts for the September executor's ordered-action contract:
a confirmation is conditional only when the exact prerequisite action is bound
and must succeed before sending. Historical claims still need actual evidence.
The older synthetic v2 evaluations remain historical benchmarks; neither those
results nor a model confidence score establish 99.9% real-world correctness.

Login now distinguishes a brands-service failure from an empty brand list.

Operational ticket data, credentials, audit output and receipts are stored only
in the ignored `output/restore-20260922` directory. No other brand's tickets are
part of this review.

## Retention history repair (September 22)

The canonical customer-history RPC omitted `support_retention_offer` from its
message projection, so later explicit customer choices could lose their proof
of a sent offer. Migration `20260922000022` preserves that server-recorded
metadata inside the existing hashed projection. Tenant filtering and execution
fences remain intact; existing proposal hashes become stale and require fresh
review. Applied to production through the Supabase SQL editor and verified
through the actual RPC and `retentionDecision`, including accepted keep choices.
The retention and customer-history regression suites pass (22 tests).
