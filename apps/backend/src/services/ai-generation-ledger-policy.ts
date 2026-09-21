function isoTimestamp(value: string | Date | undefined): string | null {
  if (value === undefined) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * A convenience caller commonly supplies only `finishedAt`. Derive the start
 * from the observed latency (or the same instant) so the append-only ledger's
 * finished_at >= started_at invariant can never race by a few milliseconds.
 */
export function normalizedGenerationRunTimestamps(input: {
  startedAt?: string | Date;
  finishedAt?: string | Date;
  latencyMs?: number;
  now?: Date;
}): { startedAt: string; finishedAt: string | null } {
  const finishedAt = isoTimestamp(input.finishedAt);
  const explicitStartedAt = isoTimestamp(input.startedAt);
  if (explicitStartedAt) return { startedAt: explicitStartedAt, finishedAt };

  if (finishedAt) {
    const finishedMs = Date.parse(finishedAt);
    if (Number.isFinite(finishedMs)) {
      const latencyMs = Number.isFinite(input.latencyMs) && Number(input.latencyMs) >= 0
        ? Math.trunc(Number(input.latencyMs))
        : 0;
      return {
        startedAt: new Date(finishedMs - latencyMs).toISOString(),
        finishedAt,
      };
    }
  }

  return {
    startedAt: (input.now ?? new Date()).toISOString(),
    finishedAt,
  };
}
