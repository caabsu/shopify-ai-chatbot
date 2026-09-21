export type LearningSignalType =
  | 'human_revision'
  | 'human_edit'
  | 'partial_approval'
  | 'clean_approval'
  | 'batch_approval'
  | 'dismissal'
  | 'execution_failure'
  | 'delayed_outcome';

export interface LearningScope {
  intent?: string;
  category?: string;
  language?: string;
  action_types?: string[];
  topics?: string[];
  product_handles?: string[];
}

export interface CalibrationSample {
  predicted: number;
  outcome: number;
  weight: number;
  occurredAt: string;
  actionType: string;
  intent?: string;
}

export interface CalibrationResult {
  raw: number;
  value: number;
  delta: number;
  sampleCount: number;
  effectiveSampleWeight: number;
  method: 'bayesian_local_v1';
}

export interface CalibrationLineageEvent {
  payload?: Record<string, unknown> | null;
}

export type LearningMemoryKind = 'style' | 'procedure' | 'fact' | 'anti_pattern';

export interface MemoryFreshnessPolicy {
  timeSensitive: boolean;
  validForDays: number | null;
}

const SIGNAL_TRUST: Record<LearningSignalType, number> = {
  human_edit: 0.99,
  human_revision: 0.97,
  partial_approval: 0.93,
  execution_failure: 0.90,
  dismissal: 0.88,
  delayed_outcome: 0.84,
  clean_approval: 0.72,
  batch_approval: 0.58,
};

const TOPIC_STOP_WORDS = new Set([
  'about', 'after', 'before', 'could', 'customer', 'email', 'from', 'have', 'hello',
  'order', 'please', 'support', 'that', 'their', 'there', 'these', 'this', 'ticket',
  'want', 'with', 'would', 'your',
]);

export function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
}

export function trustForSignal(signal: LearningSignalType): number {
  return SIGNAL_TRUST[signal];
}

/**
 * A threshold-selected batch is not an independent correctness label: the
 * model score being calibrated selected the plan in the first place. Keep the
 * episode for audit/coverage and learn from later objective outcomes, but never
 * feed the threshold decision back into answer-quality calibration.
 */
export function contributesToAnswerQualityCalibration(signal: string): boolean {
  return signal !== 'batch_approval';
}

/**
 * Clean and threshold approvals carry no human-authored correction from which
 * to extract a semantic rule. They are handled by calibration/audit paths and
 * must never enter the memory-distillation prompt.
 */
export function contributesToSemanticMemory(signal: string): boolean {
  return signal !== 'clean_approval' && signal !== 'batch_approval';
}

/**
 * Answer-quality confidence is model/prompt specific. Semantic memories and
 * human-reviewed prompt precedents remain portable, but numeric outcomes from
 * another model (or another prompt version) must not calibrate the current
 * model's self-score.
 *
 * A caller without a calibration key is in the pre-generation/semantic phase,
 * so it receives no numeric answer-quality samples. Legacy/unattributed events
 * are deliberately excluded instead of being guessed into a current lineage.
 */
export function qualityCalibrationEventsForKey<T extends CalibrationLineageEvent>(
  events: T[],
  exactCalibrationKey?: string,
): T[] {
  const key = exactCalibrationKey?.trim();
  if (!key) return [];
  return events.filter((event) => event.payload?.calibration_key === key);
}

/**
 * Resolve the freshness values passed to semantic-memory persistence as one
 * invariant. Model classification is advisory: facts always expire, even when
 * the extractor misses their time sensitivity. This changes only lifetime;
 * applicability remains constrained independently by the learned scope.
 */
export function resolveMemoryFreshness(input: {
  kind: LearningMemoryKind;
  timeSensitive: boolean;
  validForDays?: number;
}): MemoryFreshnessPolicy {
  const effectiveTimeSensitive = input.timeSensitive || input.kind === 'fact';
  if (!effectiveTimeSensitive) return { timeSensitive: false, validForDays: null };

  const proposed = Number(input.validForDays);
  const fallback = input.kind === 'fact'
    ? (input.timeSensitive ? 30 : 90)
    : 90;
  const ceiling = input.kind === 'fact' ? 90 : 365;
  const validForDays = Math.min(
    ceiling,
    Math.max(1, Number.isFinite(proposed) ? Math.round(proposed) : fallback),
  );

  return { timeSensitive: true, validForDays };
}

export function normalizeScopeValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_').slice(0, 80);
  return normalized || undefined;
}

export function topicsFromText(text: string, limit = 12): string[] {
  const tokens = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
  return [...new Set(tokens.filter((token) => !TOPIC_STOP_WORDS.has(token)))].slice(0, limit);
}

export function buildLearningScope(input: {
  subject?: string | null;
  intent?: unknown;
  category?: unknown;
  language?: unknown;
  tags?: unknown;
  actionTypes?: unknown;
  productHandles?: unknown;
}): LearningScope {
  const strings = (value: unknown, limit: number): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const items = [...new Set(value.map(normalizeScopeValue).filter((v): v is string => Boolean(v)))].slice(0, limit);
    return items.length > 0 ? items : undefined;
  };

  const subjectTopics = topicsFromText(input.subject ?? '');
  const tagTopics = strings(input.tags, 8) ?? [];
  const topics = [...new Set([...subjectTopics, ...tagTopics])].slice(0, 14);

  return compactScope({
    intent: normalizeScopeValue(input.intent),
    category: normalizeScopeValue(input.category),
    language: normalizeScopeValue(input.language),
    action_types: strings(input.actionTypes, 10),
    product_handles: strings(input.productHandles, 8),
    topics: topics.length > 0 ? topics : undefined,
  });
}

export function compactScope(scope: LearningScope): LearningScope {
  return Object.fromEntries(
    Object.entries(scope).filter(([, value]) => value !== undefined && (!Array.isArray(value) || value.length > 0)),
  ) as LearningScope;
}

function arrayOverlap(left: string[] | undefined, right: string[] | undefined): number | null {
  if (!left?.length || !right?.length) return null;
  const a = new Set(left);
  const b = new Set(right);
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection++;
  // `right` is the learned constraint. Extra context on the current ticket
  // should not reduce applicability when every learned value is present.
  return intersection / Math.max(1, b.size);
}

/**
 * Structured applicability score. An intent mismatch is deliberately expensive:
 * a correction learned on a return should not silently become a shipping rule.
 */
export function scopeMatch(current: LearningScope, learned: LearningScope): number {
  let score = 1;

  if (learned.intent) score *= current.intent === learned.intent ? 1 : current.intent ? 0.16 : 0.55;
  if (learned.category) score *= current.category === learned.category ? 1 : current.category ? 0.40 : 0.70;
  if (learned.language) score *= current.language === learned.language ? 1 : current.language ? 0.35 : 0.75;

  const actionOverlap = arrayOverlap(current.action_types, learned.action_types);
  if (learned.action_types?.length) {
    score *= actionOverlap === null ? 0.55 : actionOverlap > 0 ? 0.55 + 0.45 * actionOverlap : 0.18;
  }

  const productOverlap = arrayOverlap(current.product_handles, learned.product_handles);
  if (learned.product_handles?.length) {
    score *= productOverlap === null ? 0.55 : productOverlap > 0 ? 0.65 + 0.35 * productOverlap : 0.08;
  }

  const topicOverlap = arrayOverlap(current.topics, learned.topics);
  if (learned.topics?.length) score *= topicOverlap === null ? 0.55 : 0.30 + 0.70 * topicOverlap;

  return clamp01(score);
}

export function freshnessWeight(
  occurredAt: string | Date,
  halfLifeDays: number,
  now: Date = new Date(),
): number {
  const timestamp = occurredAt instanceof Date ? occurredAt.getTime() : new Date(occurredAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (now.getTime() - timestamp) / 86_400_000);
  return clamp01(Math.pow(0.5, ageDays / Math.max(1, halfLifeDays)));
}

export function memoryActivationScore(input: {
  status: string;
  confidence: number;
  trust: number;
  learnedScope: LearningScope;
  currentScope: LearningScope;
  updatedAt: string;
  validUntil?: string | null;
  timeSensitive?: boolean;
  now?: Date;
}): number {
  const now = input.now ?? new Date();
  if (input.status !== 'active') return 0;
  if (input.validUntil && new Date(input.validUntil).getTime() <= now.getTime()) return 0;
  const freshness = freshnessWeight(input.updatedAt, input.timeSensitive ? 30 : 240, now);
  return clamp01(input.confidence) * clamp01(input.trust) * freshness * scopeMatch(input.currentScope, input.learnedScope);
}

/**
 * Local Bayesian calibration. The model confidence is the prior mean; nearby,
 * scoped reviewed outcomes update it. With little evidence it stays close to
 * the model, while repeated edits/rejections pull it down and clean approvals
 * pull it up. Old outcomes decay instead of remaining authoritative forever.
 */
export function calibrateConfidence(
  rawConfidence: number,
  samples: CalibrationSample[],
  actionType: string,
  intent?: string,
  now: Date = new Date(),
): CalibrationResult {
  const raw = clamp01(rawConfidence);
  const priorWeight = 4;
  let outcomeWeight = 0;
  let weightedOutcome = 0;
  let sampleCount = 0;

  for (const sample of samples) {
    if (sample.actionType !== actionType) continue;
    const intentWeight = sample.intent
      ? (intent && sample.intent === intent ? 1 : intent ? 0.20 : 0.55)
      : 0.70;
    const distance = Math.abs(clamp01(sample.predicted) - raw);
    const localWeight = Math.exp(-(distance * distance) / (2 * 0.20 * 0.20));
    const recencyWeight = freshnessWeight(sample.occurredAt, 180, now);
    const weight = Math.max(0, sample.weight) * intentWeight * localWeight * recencyWeight;
    if (weight < 0.01) continue;
    outcomeWeight += weight;
    weightedOutcome += weight * clamp01(sample.outcome);
    sampleCount++;
  }

  const value = clamp01((priorWeight * raw + weightedOutcome) / (priorWeight + outcomeWeight));
  return {
    raw,
    value,
    delta: value - raw,
    sampleCount,
    effectiveSampleWeight: outcomeWeight,
    method: 'bayesian_local_v1',
  };
}

export function knowledgeConfidence(positiveWeight: number, negativeWeight: number): number {
  const positive = Math.max(0, positiveWeight);
  const negative = Math.max(0, negativeWeight);
  const prior = 0.25;
  return clamp01((prior + positive) / (prior * 2 + positive + negative));
}

export function textSimilarity(left: string, right: string): number {
  const tokenize = (value: string) => value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const token of a) counts.set(token, (counts.get(token) ?? 0) + 1);
  let overlap = 0;
  for (const token of b) {
    const count = counts.get(token) ?? 0;
    if (count > 0) {
      overlap++;
      counts.set(token, count - 1);
    }
  }
  return clamp01((2 * overlap) / (a.length + b.length));
}

export function redactLearningText(value: string, limit = 2200): string {
  return value
    .replace(/\b(hi|hello|dear)\s+[A-Z][a-z'-]{1,30}\b/gi, '$1 [name]')
    .replace(/\b[A-Z][a-z'-]{1,30}\s+[A-Z][a-z'-]{1,30}\b/g, '[name]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[id]')
    .replace(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi, '[date]')
    .replace(/\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b/g, '[date]')
    .replace(/[$€£]\s?\d[\d,]*(?:\.\d{1,2})?/g, '[amount]')
    .replace(/\b\d{1,6}\s+[A-Z0-9.' -]{2,45}\s(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|court|ct|way)\b/gi, '[address]')
    .replace(/\b\+?\d[\d().\s-]{7,}\d\b/g, '[phone-or-number]')
    .replace(/\b(?=[A-Z0-9]{12,}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+\b/gi, '[tracking-id]')
    .replace(/#\s?\d{3,}/g, '#[order]')
    .replace(/\b\d{8,}\b/g, '[number]')
    .trim()
    .slice(0, limit);
}
