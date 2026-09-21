import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { buildAutopilotLedgerAnalysis } from './autopilot-persistence.js';

test('ledger analysis adds exact top-level generation lineage without changing plan analysis', () => {
  const analysis = {
    summary: 'Customer requested cancellation.',
    model_confidence: 0.91,
    overall_confidence: 0.86,
  };
  const generation = {
    provider: 'deepseek',
    model: 'deepseek/deepseek-v4-pro',
    tier: 'pro',
    calibration_key: 'deepseek:deepseek-v4-pro:pro:support-v1',
  };

  const ledgerAnalysis = buildAutopilotLedgerAnalysis({ analysis, generation });

  assert.deepEqual(analysis, {
    summary: 'Customer requested cancellation.',
    model_confidence: 0.91,
    overall_confidence: 0.86,
  });
  assert.deepEqual(ledgerAnalysis, { ...analysis, generation });
});

test('migration accepts only the intentional generation-enriched ledger projection', () => {
  const relativeMigration = 'supabase/migrations/20260717000018_fix_autopilot_plan_generation_lineage.sql';
  const migrationPath = [
    path.resolve(process.cwd(), relativeMigration),
    path.resolve(process.cwd(), '../..', relativeMigration),
  ].find(existsSync);
  assert.ok(migrationPath, 'migration 018 must exist');
  const migration = readFileSync(migrationPath, 'utf8');

  assert.match(
    migration,
    /COALESCE\(p_ledger->'analysis', '\{\}'::jsonb\)\s+IS DISTINCT FROM \(\s+COALESCE\(p_plan->'analysis', '\{\}'::jsonb\)\s+\|\| CASE WHEN p_plan \? 'generation'/s,
  );
  assert.match(
    migration,
    /jsonb_build_object\('generation', p_plan->'generation'\)/,
  );
});

test('migration 019 makes the plan canonical for duplicated ledger fields', () => {
  const relativeMigration = 'supabase/migrations/20260810000019_canonicalize_autopilot_plan_persistence.sql';
  const migrationPath = [
    path.resolve(process.cwd(), relativeMigration),
    path.resolve(process.cwd(), '../..', relativeMigration),
  ].find(existsSync);
  assert.ok(migrationPath, 'migration 019 must exist');
  const migration = readFileSync(migrationPath, 'utf8');

  for (const field of ['actions', 'analysis', 'evidence', 'trigger', 'context_fingerprint']) {
    assert.match(migration, new RegExp(`'${field}'\\s*,\\s*(?:COALESCE\\()?p_plan->'${field}'`));
  }
  assert.match(migration, /RETURN public\.persist_autopilot_plan_v18\(/);
});
