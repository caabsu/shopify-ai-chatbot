# Autopilot Learning Architecture

## Outcome

Every reviewed plan and AI-assisted ticket reply now produces durable learning evidence. A committed approval is eligible for the next relevant draft immediately; a background worker later consolidates evidence into narrowly scoped, expiring, confidence-scored memory.

This is deliberately inference-time learning, not online model-weight fine-tuning. Updating weights after every ticket would be hard to reverse, easy to poison, and unable to respect a fact's scope or expiry. Episodic retrieval plus evidence-backed semantic memory gives immediate adaptation with provenance, rollback, and temporal controls.

## Model routing and lineage

Support inference has two explicit tiers:

- `flash`: DeepSeek V4 Flash, non-thinking, for routine drafting, summarization, intent
  detection, ticket linking, tagging, and safe read-only work.
- `pro`: DeepSeek V4 Pro, thinking enabled, for cancellations, refunds, order changes,
  conflicting messages, multiple related orders, uncertain policy, revisions, and memory
  consolidation.

The router is deterministic and inspectable. It selects Pro from ticket/order/action risk
signals rather than trusting a model to decide whether it deserves a more capable model.
A Flash plan receives one Pro retry when the call fails, violates deterministic safety
validation, drops required actions, returns no useful plan, or reports raw confidence below
the configured quality boundary.

The production access path is Vercel AI Gateway with cost sorting; the native DeepSeek API
is an optional DeepSeek-only access path. There is no cross-model fallback. Missing
credentials, exhausted budget, or provider failure fails closed so customer data cannot be
silently routed to a different model family. Every attempt is appended to
`ai_generation_runs`; the final plan also embeds provider, access provider, exact model,
tier, thinking mode, router reasons, prompt version, calibration key, request IDs, token and
cache usage, estimated cost, latency, and attempt history.

Semantic memories are portable across model cohorts because their evidence, scope, trust,
and expiry are independently validated. Numerical calibration is deliberately isolated to
the exact `provider:model:tier:prompt_version` key. A new cohort is treated as cold for batch
execution until 25 positively weighted individual human reviews exist for that exact key.
Batch approvals, legacy scores, and unreviewed generations cannot bootstrap the threshold.

## Problems in the previous loop

The original learner compressed edits, skips, dismissals, and failures into one `support_facts` paragraph. That design:

- discarded clean approvals instead of using them for calibration;
- had no plan identity, event identity, or immutable provenance;
- treated one ticket correction as potentially brand-global;
- had no source trust, knowledge confidence, validity window, or contradiction state;
- injected the same learned paragraph into every ticket;
- used raw model self-confidence as though it were calibrated;
- could mark a newer concurrent plan as learned by updating the ticket rather than the reviewed plan;
- used a process-local, cross-brand cooldown that was unsafe with multiple Railway replicas.

The review executor also had two critical hazards: concurrent requests could run a plan twice, and a failed refund/cancellation/email did not block the confirmation reply or resolve action that depended on it.

## Two-speed learning loop

```text
Human approval / edit / revision / dismissal
  -> context-version + plan-identity check
  -> atomic plan claim + immutable review episode (immediate)
  -> next relevant draft can retrieve the episode
  -> dependency-aware execution with a durable per-action receipt
  -> immediate technical-reliability calibration
  -> immutable terminal execution outcome
  -> leased background consolidation
  -> scoped semantic memory + evidence links
  -> calibrated confidence on future plans
  -> future outcome reinforces or contradicts attributed memory
```

### Fast path: episodic precedent

An approval is recorded before side effects begin. Each episode contains:

- plan ID and revision;
- actor and signal type;
- original and final action/reply forms in the private evidence record;
- approved, edited, rejected, and skipped verdicts;
- raw model confidence;
- intent/category/language/action/topic scope;
- source trust and timestamp;
- idempotency key.

Human edits and guided revisions receive the highest trust. An unchanged approval is a positive acceptance/calibration signal with lower trust; it is not automatically a new factual rule. Execution success is recorded separately as operational evidence and is not treated as proof that the wording or policy was correct.

The planner ranks recent precedents using:

```text
source trust × scope match × freshness
```

Raw replies and reviewer instructions are never copied into another ticket's prompt. The immediate path exposes only PII-free aggregates such as edit magnitude, length ratio, paragraph/question changes, approved/rejected action types, trust, and scope. The slow path may turn private evidence into a generalized memory only after redaction, scope constraining, and confidence checks.

### Slow path: semantic consolidation

The learning worker claims events with `FOR UPDATE SKIP LOCKED` plus a renewable fencing token, so an expired/slow Railway worker cannot keep writing after another replica takes over. Oversized or malformed episodes are dead-lettered individually; unrepresented events are released rather than accidentally checkpointed. It extracts atomic memories in four classes:

- `style` — response form, length, and tone;
- `procedure` — reusable support workflow;
- `fact` — reusable, human-corrected information;
- `anti_pattern` — a precise behavior to avoid.

Every memory keeps scope, evidence, trust, confidence, validity, and contradiction mass. A single human-revised episode can activate a narrow precedent. Broader generalization requires multiple independent tickets. Time-sensitive facts get a bounded TTL, and every learned fact has a defensive 90-day maximum even if the extractor misclassifies it as durable; expired memories are ineligible. Negative evidence moves a memory to `disputed` rather than silently overwriting history.

Locked support facts and live Shopify state always outrank learned memory.

## Confidence model

Plans retain both values:

- `model_confidence`: the model's raw self-score;
- `confidence`: the calibrated value shown to reviewers.

The first calibrator is a local Bayesian shrinkage model. The raw score is the prior mean. Similar historical predictions from the same action and intent update it, weighted by reviewer trust, similarity in confidence space, and time decay. Sparse cohorts remain close to the raw score; repeated corrections pull it down; repeated unchanged approvals pull it up.

Answer quality and technical feasibility are separate channels. Human review, edits, and customer outcomes calibrate whether an answer/action was appropriate. Durable action receipts calibrate whether each action type succeeds against Shopify, email, and the database. The displayed action confidence is capped by the weaker channel, so a provider outage lowers operational confidence without falsely teaching that the approved wording was poor.

Plan confidence is capped by the least-confident required action, so a high-confidence reply cannot hide a low-confidence refund or cancellation dependency.

Semantic memory has its own `confidence_score`, separate from reviewer/source `trust_score`. This distinction is essential: a trusted human can state something that is true only for one order or one week.

## Confidence-range batch execution

Batch approval is an orchestrator over the existing per-plan executor, never a second execution path. The server builds a short-lived preview from the current queue and freezes each candidate's plan ID, revision, context fingerprint/version, canonical plan-content hash, and explicit verdict for every action. The browser runs only that exact set through the ordinary per-ticket endpoint with one stable idempotency key per plan. A changed plan is reported as stale and skipped; a newer revision is never substituted automatically.

Selection uses executable confidence:

```text
minimum(plan overall_confidence, every action confidence)
```

This preserves policy caps, dependency floors, operational caps, and reviewed calibration. Raw model confidence is diagnostic only and can never cross the automation threshold on its own. The range is inclusive, deterministic, and bounded to 50 plans. Plans with expired/missing evidence, legacy identity, changed context, active execution, or local unsaved review changes are excluded before preview.

Only one plan per normalized customer, Shopify customer, order, or overlapping related-ticket set can enter a preview. A plan with an explicit `consolidate_related_tickets` action wins the collision before confidence and age, so related contacts receive one grounded reply and one grouped resolution rather than concurrent duplicate replies. Shopify cancellation/refund/address mutations are excluded by default; administrator opt-in forces sequential execution and exact-set confirmation.

A threshold-selected batch is not a clean human approval. It emits `batch_approval` at a database-capped 0.58 source trust for audit and exposure accounting, below an individually inspected unchanged approval at 0.72. It is excluded from answer-quality calibration and semantic-memory distillation, so a confidence threshold cannot recursively validate and raise itself. Human edits/revisions keep their 0.99/0.97 trust, while provider-confirmed execution and later customer/CSAT outcomes remain separate objective learning evidence.

### Cross-plan execution scopes

Preview collision suppression is an optimization, not the concurrency boundary. Every
approved action also acquires an all-or-nothing database lease over the plan's conservative
execution scope: the primary and explicitly related ticket IDs plus SHA-256 keys for
normalized email and canonical Shopify customer/order identity. All actions in
one plan use the same scope set, so an outbound reply cannot overlap another plan's order
mutation or grouped resolution. Scope acquisition is tied to the durable action receipt
and worker token, heartbeated with the receipt every 30 seconds, and re-proved immediately
before a provider operation.

A different live receipt can never steal a scope. Expired `reserved` and `uncertain`
owners remain closed until provider reconciliation; a terminal `executed`/`failed` owner
is safe to replace if cleanup was interrupted. Same-receipt recovery may install a new
worker token only after the old scope lease expires and the receipt itself proves that the
new worker owns a live reserved lease. Definitive completion/failure and admin-attested
reconciliation release the scopes; an uncertain outcome deliberately retains them.

## Customer-wide case context and grouped execution

Every emailed plan loads one canonical database projection containing all public messages from every ticket and chatbot conversation for the same normalized customer email. It derives delivery-aware response state (`unanswered`, `awaiting_us`, `awaiting_customer`, or terminal), lists every thread in a complete manifest, and includes full transcripts up to a 90k-character history budget. The current ticket's newest customer and agent turns have protected space and oversized messages preserve both head and tail. If that budget is exceeded, overflow is explicit and the unabridged database projection still participates in the evidence hash.

The database, backend planner, and admin executor share that exact hash. It is checked before approval and again immediately before email reservation; a new parallel ticket, chat, public message, delivery-state change, or semantic ticket-state change makes the draft stale. Same customer identity grants context only. It never proves that two tickets are the same case.

`consolidate_related_tickets` is therefore a separate reviewed action. Candidates first pass an exact brand/normalized-email fence plus strong case signals such as the same order reference, original chat escalation, or combined subject/intent evidence. The model chooses only exact-case continuations, the server replaces raw IDs with immutable ticket/version/state/relation snapshots, and the UI exposes every target and confidence. Execution sends one primary reply, then an atomic SQL function locks targets in deterministic order, revalidates identity and versions, rejects active/uncertain source runs, closes and links sources, preserves their messages in place, supersedes their plans, writes audit events, and completes the durable action receipt in the same transaction.

Cancellation uses a separate fail-closed path. An explicit current customer/reviewer request is deterministically bound to a live Shopify order, including configured names such as `#WBD1025`; a later “instead” request replaces the earlier target. Fulfillment status is treated as risk evidence rather than the authoritative eligibility decision: tracking or any non-`UNFULFILLED` state disables automatic restocking and lowers confidence. The executor requires `write_orders`, supports legacy and current `orderCancel` refund inputs, waits for Shopify's asynchronous job, refetches the order, and will not unlock a success reply until job completion, `cancelledAt`, and any expected full payment refund are verified. Final reviewer-edited text is rechecked against executed, order-scoped actions immediately before send. Refund and address mutations have equivalent deterministic authorization fences: a current direct request must identify the order, an unpriced refund is executable only when the customer explicitly requests a full/whole-order refund, and every proposed address value must appear verbatim in the authorizing customer/reviewer message. Item-, quantity-, fee-, damage-, or fraction-scoped refunds without an exact amount remain review-only.

## Safety and concurrency invariants

1. A plan has an immutable UUID, canonical ledger revision, parent, prompt/model version, context fingerprint, and monotonic ticket `context_version`.
2. Customer/agent messages and decision-relevant ticket fields bump `context_version`; approval requires the exact plan/revision/version shown in the UI.
3. Plan persistence, supersession, attribution, and proposal audit are one transaction. Decision claim, review evidence, ledger state, and ticket audit are another transaction; only one request can claim `proposed`.
4. Every action has an explicit verdict. Missing action input never defaults to approval.
5. Empty edited replies are rejected rather than falling back to the original draft.
6. Confirmation replies depend on successful, order-scoped mutations; related-ticket consolidation depends on the one primary reply; resolve depends on both. Final edited wording is revalidated before claim and send.
7. Plans and manual AI drafts carry a versioned canonical hash and validity window for the complete Shopify customer/order prompt snapshot (profile, line items, fulfillment/tracking details, dates, and cancellation state). Approval/send rejects expired evidence, re-fetches the same projection, and compares it before use; mutations also re-read live state and verify the order email belongs to the ticket customer.
8. A manual reply atomically invalidates a pending plan, inserts the message, consumes its one-shot AI generation, and captures the human review. Customer-facing status and first-response state finalize only after provider-confirmed delivery. It is rejected while Autopilot is executing.
9. Every action reserves a stable operation key plus its expected post-action context before its side effect and commits an immutable receipt afterward. The reservation carries a per-request worker token and a renewable 120-second lease (heartbeated every 30 seconds, with bounded exponential retry after transient heartbeat errors). Every Shopify/Resend request receives an abort signal with a 75-second deadline; beginning one also renews the lease and records the provider deadline. A concurrent retry sees a live lease as `202 in_progress` and keeps the same execution attempt in the queue. Only an expired lease becomes `uncertain`; completion is fenced to the owning worker token, and the system never repeats it automatically.
10. Reconciliation requires an explicit, recent provider attestation and a reference/note. A claimed failure remains disabled until 90 seconds after both the final lease and provider deadline. Under a ticket/plan/receipt lock, the reconciler accepts context only when it exactly matches the reserved expectation and the local effect is tied to that receipt (the outbound message or a receipt-tagged ticket event). Otherwise it terminalizes the stale run and skips every remaining action rather than swallowing unrelated customer context.
11. Final execution persistence cannot overwrite a customer-reply replan. Execution checks context before every action, preserves a successful action if context changes immediately afterward, and checkpoints the terminal plan transactionally.
12. Shared memory text is redacted, scoped, freshness-weighted from its last supporting evidence (not maintenance time), and never overrides locked/live data.
13. Learning evidence is append-only; workers may update only processing lease/checkpoint fields. Transient provider errors back off, while deterministic poison episodes are isolated and eventually dead-lettered.
14. Memory extraction and evidence writes are idempotent, lease-fenced, and versioned by statement hash and scope. A high-trust human correction disputes an older semantic sibling instead of strengthening or co-activating stale wording.
15. Outbound customer email and manual UI retries reuse a stable logical operation key, preventing duplicate messages/delivery after lost responses.
16. CSAT uses a signed, single-use request bound to the exact plan/revision/execution attempt or manual generation/message. GET is non-mutating; a confirmation POST records the first score, so link scanners cannot create learning labels.
17. Customer-wide support history is database-canonical and revalidated at approval and again inside the durable receipt/scope boundary immediately before every send, cancellation, refund, or address mutation—not only on resumed runs. Each such action also rechecks Shopify evidence while excluding only order changes already proven complete or quarantined in that exact execution attempt. Exact identity is a context fence, while consolidation additionally requires explicit same-case evidence, immutable target snapshots, and an atomic receipt-bound transaction.
18. Every execution compares per-order Shopify evidence for every order the exact attempt did not mutate, so an expected change to order A cannot hide stale facts about order B.
19. Every learned `fact` expires within 90 days even if the extractor misses its time-sensitive nature; explicitly time-sensitive facts default to a shorter window.
20. A batch preview freezes an exact content hash and action verdict for every plan, suppresses customer/order/related-ticket collisions, and reuses the normal per-plan evidence, claim, receipt, and dependency fences.
21. Threshold-selected batch approvals have their own lower-trust audit signal and cannot calibrate answer quality, render as clean human-reviewed precedent, or enter semantic-memory distillation; learning comes from independent human or objective outcome evidence.
22. Every action is fenced by a database-leased, deterministic cross-plan scope over customer, order, primary-ticket, and related-ticket identity. Acquisition is atomic; lease loss stops the run, and an uncertain owner is never auto-stolen.

Postgres cannot share a transaction with Shopify or an email provider, so absolute cross-system exactly-once execution is impossible without provider participation. The receipt/outbox boundary makes that failure mode explicit: email also has provider-level idempotency; Shopify mutations are live-state-checked and carry a stable operation reference where supported; an ambiguous result is quarantined for human reconciliation and is never repeated automatically.

## Main data model

Migration [`012-autopilot-learning-loop.sql`](migrations/012-autopilot-learning-loop.sql) adds:

- `ticket_action_plans` — stable plan ledger and learning attribution;
- `autopilot_learning_events` — immutable review, manual-draft, execution, and delayed-outcome episodes;
- `autopilot_draft_generations` — server-side original draft, full prompt-evidence hash, and source lineage for the ticket composer; a draft is never returned if this provenance write fails;
- `autopilot_action_executions` — durable per-action reservation, expected context, fenced worker lease/heartbeat, bounded provider window, outcome, provider attestation, and reconciliation state;
- `autopilot_learning_memories` — current scoped semantic memory;
- `autopilot_learning_evidence` — event-to-memory support/contradiction links;
- `autopilot_run_memory_attributions` — which memories affected each plan;
- atomic plan persist/decision/finalization, per-action reserve/heartbeat/provider-window/complete/reconcile, and manual-message delivery functions;
- durable tokenized claim/heartbeat/finalize/merge functions.

`tickets.metadata.autopilot` remains a compatibility projection for the current UI. The normalized plan ledger is dual-written so the program can migrate queue reads and execution fully out of ticket JSON in a later release.

Migration [`013-autopilot-customer-context.sql`](migrations/013-autopilot-customer-context.sql) adds a canonical, lossless customer-support context projection across email tickets and chatbot conversations. Its database-produced hash is stored on every emailed reply plan and re-read before approval, so a new message or parallel thread invalidates stale wording. It also adds `consolidate_related_tickets`: one reviewed, atomic action that closes and links explicitly selected active threads, preserves every source message, supersedes duplicate pending plans, and completes its action receipt in the same transaction. Exact normalized customer identity is only an eligibility fence; the planner must still provide per-ticket relationship evidence and confidence.

Migration [`014-manual-ticket-link.sql`](migrations/014-manual-ticket-link.sql) gives the dashboard's human merge control the same transactional guarantees: exact context-version fences, normalized identity checks, deterministic locks, active/uncertain-run rejection, preserved source histories, source-plan supersession, one context bump per ticket, and idempotent replay. It also atomically redirects inbound replies that race a link, so a message cannot reopen or replan a closed source ticket. Inbound append, manual linking, and Autopilot consolidation acquire the same brand/customer advisory lock before ticket locks, preventing opposite redirect/merge lock orders; replay succeeds only when canonical and legacy link pointers agree.

Migration [`015-autopilot-batch-learning.sql`](migrations/015-autopilot-batch-learning.sql) adds the distinct `batch_approval` audit signal and enforces its 0.58 trust ceiling. Application policy keeps that signal out of answer-quality calibration and semantic-memory distillation so threshold automation never masquerades as—or recursively substitutes for—individual human review.

Migration [`016-autopilot-execution-scope-locks.sql`](migrations/016-autopilot-execution-scope-locks.sql) adds service-role-only cross-plan execution leases and atomic acquire/heartbeat/release RPCs. These locks turn the queue's customer/order/related-ticket collision policy into a database-enforced runtime invariant across tabs, admins, server instances, and batch workers.

## Operational rollout

1. Apply migration 012, then 013, 014, 015, and 016 before deploying the new backend/admin code.
2. Keep every action human-reviewed while inspecting episode quality, scope, and PII redaction.
3. Enable scoped episodic retrieval for one brand and compare edit/acceptance rates.
4. Enable semantic memory after evidence and expiry behavior are verified.
5. Keep irreversible Shopify actions human-approved until calibrated precision and coverage meet an explicit threshold.
6. Monitor delayed labels from lineage-bound CSAT and customer follow-up; add a no-reopen maturation label once enough chronological data exists.
7. Evaluate chronologically: feedback from ticket T1 may affect T2, never T0 or T1's original proposal.

## Metrics to monitor

- acceptance without edit;
- edit similarity and revision rate;
- skipped/dismissed action rate;
- execution failure by action type;
- reopen, requested-follow-up, and contradictory customer-follow-up rate;
- CSAT by plan/memory cohort;
- Brier score and expected calibration error;
- precision and coverage at possible automation thresholds;
- memory activation, contradiction, expiry, and retrieval attribution;
- correction lag: reviewed episode commit to first affected later draft.

The system is designed to become more precise with evidence while remaining approval-gated, explainable, and reversible.
