import assert from 'node:assert/strict';
import test from 'node:test';
import {
  autopilotConflictNeedsRegeneration,
  batchDecisionCompletion,
  consolidatedTicketIdsFromPlan,
  type AutopilotDecisionResult,
} from './autopilot-client';

function result(plan: Record<string, unknown>): AutopilotDecisionResult {
  return {
    ok: true,
    status: 200,
    code: null,
    error: null,
    data: { plan },
  };
}

test('batch success requires a fully executed durable plan', () => {
  assert.equal(batchDecisionCompletion(result({
    status: 'executed',
    actions: [
      { status: 'executed' },
      { status: 'executed' },
    ],
  })).completed, true);
});

test('a 200 response with failed or partial actions is never reported as batch success', () => {
  for (const plan of [
    { status: 'failed', actions: [{ status: 'failed', result: 'Scope is busy' }] },
    { status: 'partially_executed', actions: [{ status: 'executed' }, { status: 'failed' }] },
    { status: 'executing', actions: [{ status: 'approved' }] },
  ]) {
    assert.equal(batchDecisionCompletion(result(plan)).completed, false);
  }
});

test('an exact terminal replay is successful only when its stored plan succeeded', () => {
  const succeeded = result({ status: 'executed', actions: [{ status: 'executed' }] });
  succeeded.data.replayed = true;
  assert.deepEqual(batchDecisionCompletion(succeeded), {
    completed: true,
    message: 'Already completed; the exact durable result was replayed.',
  });

  const failed = result({ status: 'failed', actions: [{ status: 'failed' }] });
  failed.data.replayed = true;
  assert.equal(batchDecisionCompletion(failed).completed, false);
});

test('only conflicts that make the current draft unsafe request regeneration', () => {
  for (const code of ['EVIDENCE_STALE', 'CONTEXT_CHANGED', 'LEGACY_PLAN']) {
    assert.equal(autopilotConflictNeedsRegeneration(code), true);
  }
  for (const code of [
    'PLAN_REPLACED',
    'PLAN_REVISION_CHANGED',
    'PLAN_ALREADY_EXECUTING',
    'EVIDENCE_UNAVAILABLE',
    null,
  ]) {
    assert.equal(autopilotConflictNeedsRegeneration(code), false);
  }
});

test('extracts every duplicate closed by an executed consolidation plan', () => {
  assert.deepEqual(consolidatedTicketIdsFromPlan({
    actions: [{
      type: 'consolidate_related_tickets',
      params: {
        related_ticket_ids: ['ticket-3349'],
        related_tickets: [
          { ticket_id: 'ticket-3349', ticket_number: 3349 },
          { ticket_id: 'ticket-3350', ticket_number: 3350 },
        ],
      },
    }],
  }), ['ticket-3349', 'ticket-3350']);
  assert.deepEqual(consolidatedTicketIdsFromPlan(null), []);
});
