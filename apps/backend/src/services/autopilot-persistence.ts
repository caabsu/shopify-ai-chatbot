/**
 * The normalized plan ledger stores immutable model lineage inside its
 * existing `analysis` JSONB column. The ticket projection keeps that lineage
 * at the plan's top level. This is the one intentional shape difference.
 */
export function buildAutopilotLedgerAnalysis<
  TAnalysis extends object,
  TGeneration,
>(plan: {
  analysis: TAnalysis;
  generation?: TGeneration;
}): TAnalysis & { generation?: TGeneration } {
  return {
    ...plan.analysis,
    ...(plan.generation !== undefined ? { generation: plan.generation } : {}),
  };
}
