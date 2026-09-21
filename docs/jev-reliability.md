> Historical June-checkout implementation/evaluation notes. Current DeepSeek integration: [September restoration and Jev](september-restoration-and-jev.md). Prior synthetic results are not validation of the restored production pipeline.

# The 99.9% reply quality target

Target: at least 99.9% of replies accepted by the quality policy are materially correct. Uncertain tickets remain with a human. This target concerns accepted replies; it does not mean automatically handling 99.9% of incoming tickets. Report acceptance coverage alongside correctness so that rejecting everything cannot appear successful.

The implementation does **not** currently demonstrate 99.9% production correctness. Local backend and dashboard remain in `shadow` mode, and sending still requires human approval. Nothing in an evaluation report changes deployment configuration or authorizes sending.

## What changed

`support-quality-v2` gives each Noul check explicit true/false criteria. It distinguishes customer statements from authoritative facts, previous promises from completed actions, and honest limitations from missing answers. Intake considers the latest message in the full conversation, including outstanding commitments and information the customer was asked to supply. Raw predicted class is recorded separately from the conservative routing decision and whether review is needed.

Acceptance thresholds were not lowered. A good tone score cannot compensate for an unsupported factual claim or an unfinished action described as completed. Unavailable evidence, model failures, stale context, and uncertain checks retain review. At most one targeted repair is allowed for a clear defect. Shared cached assessments, batched judgments, and the repair limit constrain cost without changing the writer to a cheaper model.

Jev's [confidence](https://docs.typesafe.ai/confidence) describes concentration of a prediction distribution. A value of `0.999` is not evidence of 99.9% accuracy on our tickets. [Noul criteria](https://docs.typesafe.ai/primitives/noul) define what a check judges; their empirical error rates still need measurement.

## Current live evidence

The [saved report](evaluations/jev-1.13.0-v2.json) covers 47 synthetic cases evaluated with `jev-1.13.0` and rubric v2. The starter set informed rubric changes; challenge and classification labels were fixed before their first v2 live run. None is a representative, independently human-audited production sample.

| Measure | Observed result |
| --- | --- |
| Defective drafts blocked | 14 / 14 |
| Acceptable drafts passing | 9 / 11; two still need review |
| Passing drafts containing a labeled defect | 0 / 9 |
| Passing drafts as a share of all tested drafts | 9 / 25 (36%) |
| Raw email classes matching labels | 22 / 22 |
| Uncertain non-support classifications routed to support | 3 |
| Support requests excluded from the support queue | 0 |
| Acknowledgements qualifying to skip drafting | 0; three still generated unnecessary draft work |
| Exact expected workflow outcomes | 39 / 47 |
| Provider failures | 0 / 47 |
| Estimated Jev inference cost | $0.003000144 for 71,432 input tokens |

The cost excludes writing, tools, human review, and earlier v1 experiments. These results do not measure writer quality, improvement from repair, or end-to-end cost per accepted reply. Because no acknowledgement passed the skip threshold, the live suite supplies no positive evidence for safe acknowledgement suppression. The eight workflow mismatches were conservative: two acceptable drafts required review, three acknowledgements were not suppressed, and three uncertain non-support messages stayed in support.

## Evidence needed before claiming the target

Freeze the model, rubrics, thresholds, writer, and source-building policy. For each brand and workflow that will be eligible for automatic sending, independently sample representative historical or shadow-mode tickets and have humans judge the proposed final reply against the actual evidence. Reviewers should label material errors without using Jev's verdict as ground truth. Include incorrect amounts, dates, product claims, unsupported commitments, omitted requests, and false confirmations. Audit the final reply and action outcome, not only an earlier draft.

With zero errors, **2,995 independent accepted replies per brand/workflow** give a one-sided 95% exact lower confidence bound of at least 99.9% correctness. This follows from the [exact binomial method](https://itl.nist.gov/div898/software/dataplot/refman2/auxillar/exacbino.htm): the upper error bound is `1 - 0.05^(1/n)`. Errors require a larger sample; the evaluator calculates the exact bound rather than applying the zero-error shortcut. This is a statistical bound under the sampling assumptions, not a guarantee about future traffic, and the bounds are per workflow rather than simultaneous across all brands.

Keep tuning examples outside that audit. Do not count repeated variants of one ticket as independent evidence. Human approval or an unedited send alone does not establish correctness. Reassess after policy/model/source changes and track customer corrections and reopened tickets. Start with narrow workflows that have verified facts; expand only as their own evidence supports it.

The report's `supported_by_held_out_audits` flag counts only accepted drafts with all the audit attestations below. It excludes duplicate ticket units and identical input contexts. The operator is responsible for the truth of the attestations and independence/representativeness of the sample. The flag is an evaluation indicator, not an automatic runtime rollout gate.

```json
{
  "id": "unique-evaluation-case",
  "brand": "brand-slug",
  "kind": "draft",
  "workflow": "order_status",
  "origin": "historical",
  "audit": {
    "independent_unit_id": "anonymized-ticket-id",
    "held_out": true,
    "human_reviewed": true,
    "representative_sample": true
  },
  "expected": { "status": "passed" }
}
```

This shows audit metadata only; also supply `draft` and the full `context` using the fixture format. An incorrect draft gets expected status `needs_review`. Choose workflow labels before reviewing model outcomes. Never mark synthetic or development cases as historical held-out audits.

## Reproduction

```sh
npm run test:support-ai
npm run eval:support-ai -- tests/fixtures/support-ai.json /tmp/jev-v2-starter.json
npm run eval:support-ai -- tests/fixtures/support-ai-challenge.json /tmp/jev-v2-challenge.json
npm run eval:support-ai -- tests/fixtures/support-ai-classification.json /tmp/jev-v2-classification.json
```

The evaluation commands require the private key and make paid Jev calls unless a matching `.runs.json` cache is present. They do not call the writer, update tickets, or send messages. Exit code 1 reports an expected-outcome mismatch; the saved metrics distinguish unsafe passes from unnecessary review. Add `--check-fixtures` after a fixture path for validation without inference. Reports record rubric version, audit eligibility, false approvals, coverage, missed requests, raw classification errors, routing abstentions, and exact statistical bounds.
