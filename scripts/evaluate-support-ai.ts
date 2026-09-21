import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createSupportAi, getJevConfig, contentHash, SUPPORT_AI_VERSION, type AiRun, type AiStore, type DraftContext, type IntakeState,
} from '../apps/backend/src/services/support-ai.js';
import { summarizeSupportEvaluation, type EvaluationFixture, type EvaluationResult } from '../apps/backend/src/services/support-evaluation.js';

type Fixture = EvaluationFixture & (
  { kind: 'intake'; state: IntakeState; expected: { classification: string; skip_draft: boolean } } |
  { kind: 'draft'; draft: string; context: DraftContext; expected: { status: 'passed' | 'needs_review'; defects?: string[] } }
);

async function main() {
  const fixturePath = resolve(process.argv[2] || 'tests/fixtures/support-ai.json');
  const fixtures: Fixture[] = JSON.parse(await readFile(fixturePath, 'utf8'));
  if (!Array.isArray(fixtures) || !fixtures.length || new Set(fixtures.map(f => f.id)).size !== fixtures.length) throw new Error('Fixtures must be a nonempty array with unique IDs');
  for (const fixture of fixtures) {
    if (!fixture.id || !fixture.brand || !fixture.expected || !['intake', 'draft'].includes(fixture.kind)) throw new Error('Invalid fixture');
    if (fixture.kind === 'draft' && (!fixture.draft || !fixture.context?.conversation || !fixture.context.signoff)) throw new Error(`Incomplete draft fixture: ${fixture.id}`);
    if (fixture.kind === 'intake' && !fixture.state?.thread) throw new Error(`Incomplete intake fixture: ${fixture.id}`);
    if (fixture.kind === 'draft' && !['passed', 'needs_review'].includes(fixture.expected.status)) throw new Error(`Invalid draft label: ${fixture.id}`);
    if (fixture.kind === 'intake' && (typeof fixture.expected.skip_draft !== 'boolean' || !['customer_support', 'promotional', 'transactional', 'automated', 'spam', 'internal'].includes(fixture.expected.classification))) throw new Error(`Invalid intake label: ${fixture.id}`);
  }
  if (process.argv.includes('--check-fixtures')) {
    console.log(`${fixtures.length} fixtures valid. No provider calls made.`);
    return;
  }
  const config = getJevConfig({ ...process.env, JEV_MODE: 'active' });
  const output = resolve(process.argv[3] || '/tmp/support-ai-evaluation.json');
  await mkdir(dirname(output), { recursive: true });
  const runPath = `${output}.runs.json`;
  let runs: AiRun[] = [];
  try { runs = JSON.parse(await readFile(runPath, 'utf8')); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const priorIds = new Set(runs.map(run => run.id));
  const store: AiStore = {
    async find(hash) { return [...runs].reverse().find(run => run.request_hash === hash && run.status !== 'running') ?? null; },
    async save(run) {
      const i = runs.findIndex(saved => saved.id === run.id);
      if (i < 0) runs.push(run); else runs[i] = run;
      await writeFile(runPath, JSON.stringify(runs, null, 2), { mode: 0o600 });
    },
  };
  const results: EvaluationResult[] = [];
  for (const fixture of fixtures) {
    const ai = createSupportAi({ store, config, scope: `evaluation:${fixture.brand}:${fixture.id}` });
    if (fixture.kind === 'intake') {
      const actual = await ai.intake(fixture.state);
      results.push({ id: fixture.id, brand: fixture.brand, kind: fixture.kind, workflow: fixture.workflow, origin: fixture.origin, audit: fixture.audit, expected: fixture.expected, actual,
        input_fingerprint: contentHash(fixture.state),
        passed: actual.evaluation.status === 'completed' && actual.classification === fixture.expected.classification && actual.skip_draft === fixture.expected.skip_draft });
    } else {
      const actual = await ai.review(fixture.draft, fixture.context);
      results.push({ id: fixture.id, brand: fixture.brand, kind: fixture.kind, workflow: fixture.workflow, origin: fixture.origin, audit: fixture.audit, expected: fixture.expected, actual,
        input_fingerprint: contentHash(fixture.context),
        passed: actual.status === fixture.expected.status && (fixture.expected.defects ?? []).every(key => (actual.defects[key as keyof typeof actual.defects] ?? 0) > 0.15) });
    }
  }
  const newRuns = runs.filter(run => !priorIds.has(run.id));
  const report = { model: config.model, rubric_version: SUPPORT_AI_VERSION, generated_at: new Date().toISOString(), fixture_path: fixturePath,
    passed: results.filter(result => result.passed).length, total: results.length,
    new_provider_calls: newRuns.length, failed_calls: newRuns.filter(run => run.status === 'failed').length,
    estimated_new_cost_usd: newRuns.reduce((sum, run) => sum + (run.usage?.estimated_cost_usd ?? 0), 0), metrics: summarizeSupportEvaluation(results), results };
  await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(`${report.passed}/${report.total} expected outcomes matched. ${report.new_provider_calls} new calls, ${report.failed_calls} failed. Report: ${output}`);
  console.log(`Drafts: ${report.metrics.draft_quality.approved} approved, ${report.metrics.draft_quality.unsafe_approvals} unsafe approvals. Intake: ${report.metrics.intake.unsafe_skips} unsafe skips. 99.9% supported by held-out audits: ${report.metrics.reliability_target.supported_by_held_out_audits}.`);
  if (report.passed !== report.total) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Evaluation failed'); process.exitCode = 1; });
