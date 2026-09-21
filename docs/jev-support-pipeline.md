> Historical June-checkout implementation/evaluation notes. Current DeepSeek integration: [September restoration and Jev](september-restoration-and-jev.md). Prior synthetic results are not validation of the restored production pipeline.

# Jev support pipeline

The email and ticket workflow uses Jev for bounded judgments and keeps Sonnet as the writer. Every send still requires the existing human approval. A passing Jev assessment is not an automatic-send authorization or a calibrated probability of correctness. See the [99.9% reliability target and evidence](jev-reliability.md) for the current v2 rubric, live evaluation, and held-out audit requirements.

## Behavior

1. Persist the inbound email before classification, including non-support mail. Nothing is silently deleted because Jev calls it spam.
2. Batch email class, intent, sentiment, priority, unresolved obligations, newly supplied information, and acknowledgement-only detection into one Jev call. Classification, triage, and Autopilot reuse the same assessment for the same conversation.
3. Generate a grounded draft using the existing writer. An unambiguous acknowledgement may instead propose resolution without another email, provided the thread has a prior agent response, no unresolved obligation, no newly supplied information, and no unread attachments.
4. Batch three independent Score rubrics (coverage, clarity, brand tone, each 0–3) and six Noul checks: unsupported facts, asking for known information, contradicting a commitment, confirming an unfinished action, unsolicited offers, and missing evidence.
5. In active mode, a clear, fixable defect permits one targeted writer repair followed by reassessment. Uncertain judgments, unavailable sources, and missing evidence go to human review. There is no rewrite loop.
6. The UI shows dimension scores, assessment certainty, concrete findings, revision status, and model/cost details. Editing text makes the visible assessment stale. The manual ticket editor can check the current text again and restores saved drafts after a reload.
7. Autopilot rechecks edited drafts at approval. Unpassed active assessments require the reviewer to acknowledge the findings. Changed conversation, policy/product source revisions, or current order facts invalidate a queued plan. A compare-and-set claim prevents double execution of a plan. Skipped or failed order actions block the dependent email; a failed email blocks resolution and the satisfaction request.

Both Railway and Next.js import the same evaluator and rubric. The admin's facade is server-only; UI imports its types only. Attachments are not interpreted by this text-only model and keep a draft in manual review when present. Unavailable data never becomes a positive quality assessment.

## Configuration

Set these on **both** the backend (Railway/root `.env`) and dashboard (Vercel/`apps/admin/.env.local`):

```dotenv
TYPESAFE_API_KEY=your-private-key
JEV_MODE=shadow
JEV_MODEL=jev-1.13.0
JEV_TIMEOUT_MS=8000
```

Never use a `NEXT_PUBLIC_` variable for the key. No new database migration is required: runs use existing `ticket_events` records.

- `off`: no Jev calls. Existing classification/triage fallback and writer remain available; drafts say they are unassessed.
- `shadow`: record and show Jev judgments without changing classification, skipping drafts, repairing text, or enforcing a quality acknowledgement.
- `active`: use the complete pipeline described above. Human approval remains required.

Without a key the default is off; with a key and no explicit mode it is active. Explicit shadow/active without a key fails configuration validation. Set an explicit mode on both hosts. Existing `AUTOPILOT_BRANDS` still controls which brands receive proposed Autopilot plans.

Jev HTTP failures, invalid distributions, model-version drift, oversized input, timeout, and persistence failures never pass a draft. A failed identical request has a 30-second cooldown; no automatic provider retry is made. Inputs over a conservative 48 KB serialized budget require manual review rather than silently truncating the conversation. Model upgrades change cache keys.

## Cost and audit records

Each paid inference is saved before its provider call, then completed/failed with a UUID, stage, input, request hash, actual model, rubric version, latency, token usage, and estimated USD cost. Writes and reads verify ticket/brand ownership. Completed identical requests are reused across hosts and reloads; failed results only suppress retries briefly. Writer outputs and final draft/assessment pairs are stored, too. Final draft IDs also link reviewer feedback when Jev is disabled.

`event_type = support_ai_run`, `metadata.stage` is one of `intake`, `draft_review`, `autopilot_plan`, `manual_draft`, `draft_repair`, fallback classifier/triage stages, or `draft_result`. `draft_result` is a UI snapshot and has no additional inference cost. Sum usage once per inference UUID; cached assessments are not new calls. Prices are estimates pinned in `modelUsage` and should be updated with pricing changes; provider billing remains authoritative.

Manual sends retain original/final text and the assessment in `draft_feedback` events. Autopilot retains edited originals on action params plus review acknowledgements on `autopilot_executed`. These records support human labeling and edit-rate/cost analysis; human edits are not automatically assumed correct or used to change the rubric.

Example cost query (use your brand ID):

```sql
select metadata->>'stage' as stage,
       count(*) as completed_calls,
       sum((metadata->'usage'->>'input_tokens')::bigint) as input_tokens,
       sum((metadata->'usage'->>'estimated_cost_usd')::numeric) as estimated_usd
from ticket_events
where event_type = 'support_ai_run'
  and metadata->>'status' = 'completed'
  and metadata->>'brand_id' = :brand_id
  and metadata->'usage' is not null
  and metadata->>'stage' <> 'draft_result'
group by 1;
```

These records contain customer support content and use the same access/retention controls as tickets. Do not expose the service-role client or provider key in browser bundles.

## Verification and evaluation

```sh
npm run test:support-ai
npm run build:backend
npm run build:admin
npm run eval:support-ai -- tests/fixtures/support-ai.json --check-fixtures
```

The unit suite uses mocked providers and covers orchestration, cache invalidation, failures, brand scoping, quality gates, repair limits, and action dependencies. It does **not** establish Jev's real-world accuracy.

Run real Jev judgments against the synthetic starter fixtures with a configured key:

```sh
npm run eval:support-ai -- tests/fixtures/support-ai.json /tmp/jev-evaluation.json
```

The evaluator makes paid Jev requests, never writes to production tickets, never invokes a writer, and never sends email. It saves the report plus `/tmp/jev-evaluation.json.runs.json`; repeating the command reuses completed unchanged cases. It exits nonzero when an expected outcome does not match or an assessment is unavailable. The `--check-fixtures` mode only checks fixture shape and costs nothing.

Replace/extend the starter data with anonymized, human-labeled historical cases per brand and intent, including bad-but-fluent drafts, prior commitments, missing evidence, acknowledgements with outstanding work, prompt injection, returns, and multilingual cases. Keep tuning cases separate from held-out evaluation cases. Compare false passes on material defects, unnecessary-review rate, missed customer requests, editor acceptance/edit rate, cost per accepted response, and latency. Compare initial and repaired results separately. Track reopenings/customer corrections where labels are available.

Initial thresholds are conservative engineering defaults, **not measured calibration**: scores need a mean of at least 2.4/3, no more than 0.1 mass on scores 0–1, and confidence at least 0.5; each defect must be at most 0.15. A repair requires clear evidence of a defect (typically at least 0.7) or a clearly low score. Acknowledgement suppression requires at least 0.98 acknowledgement and at most 0.02 unresolved/new-information likelihood. Do not interpret these values as empirical error rates.

Start in shadow mode, label the disagreements, and enable active routing only after checking held-out outcomes for each brand. Keep the current writer initially. A cheaper writer should be introduced only after paired evaluation shows comparable factual accuracy, coverage, and reviewer acceptance; this change does not silently switch writing models.

## Provider references

- [TypeSafe API](https://docs.typesafe.ai/api)
- [Jev models](https://docs.typesafe.ai/models)
- [Score primitive](https://docs.typesafe.ai/primitives/score)
- [Noul primitive](https://docs.typesafe.ai/primitives/noul)

The implementation pins `jev-1.13.0` and the documented `/v1/systemone` request contract. Live model behavior and production credentials must be validated separately from mocked integration tests.

## Initial live validation (v1 baseline)

The initial [live evaluation](evaluations/jev-1.13.0-initial.json) completed all nine synthetic cases without provider errors; seven matched the expected outcomes. No defective-draft example received a passing assessment. The two mismatches were an acceptable status reply flagged for review and an acknowledgement that did not qualify to skip drafting. Estimated total Jev cost was $0.000461. These cases are a starter check, not measured production accuracy. Local backend and dashboard configuration remains in shadow mode; deployed environments have not been changed.
