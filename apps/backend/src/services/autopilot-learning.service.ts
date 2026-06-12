import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { isAutopilotBrand, type AutopilotPlan, type AutopilotAction } from './autopilot.service.js';

/**
 * Autopilot learning loop.
 *
 * Every reviewed plan is a training signal: replies the reviewer edited
 * (correction), instructions they typed before approving (missing knowledge),
 * actions they unchecked (bad proposals), plans they dismissed, and executions
 * that failed. This service distills those signals into a living "learned
 * lessons" document stored in support_facts — which loadSupportContext feeds
 * into EVERY future planner call. Closed loop: review → distill → better plans.
 *
 * Runs from the 5-minute maintenance interval; throttled so the distiller only
 * fires when there's enough new signal (or a backlog of clean approvals to
 * acknowledge), at most twice an hour.
 */

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

const DISTILL_MODEL = 'claude-sonnet-4-6';
const LESSONS_FACT_KEY = 'autopilot_learned_lessons';
const MIN_SIGNAL_TO_DISTILL = 1;
const DISTILL_COOLDOWN_MS = 30 * 60 * 1000;

let lastDistillAt = 0;

interface Episode {
  ticket_number: number;
  subject: string;
  intent?: string;
  outcome: string; // executed | partially_executed | dismissed
  operator_instructions: string[];
  edited_replies: Array<{ original?: string; final: string }>;
  skipped_actions: string[];
  failed_actions: string[];
  hasSignal: boolean;
}

export async function runLearningCycle(): Promise<void> {
  const { data: brands } = await supabase.from('brands').select('id, slug').eq('enabled', true);
  for (const brand of brands ?? []) {
    if (!(await isAutopilotBrand(brand.id as string))) continue;
    try {
      await learnForBrand(brand.id as string, brand.slug as string);
    } catch (err) {
      console.error(`[autopilot-learning] ${brand.slug} cycle failed:`, err instanceof Error ? err.message : err);
    }
  }
}

async function learnForBrand(brandId: string, slug: string): Promise<void> {
  const { data: rows } = await supabase
    .from('tickets')
    .select('id, ticket_number, subject, metadata')
    .eq('brand_id', brandId)
    .filter('metadata->autopilot->>status', 'in', '(executed,partially_executed,dismissed)')
    .filter('metadata->autopilot->>learned_at', 'is', 'null')
    .order('updated_at', { ascending: true })
    .limit(12);

  if (!rows || rows.length === 0) return;

  const episodes = rows.map(buildEpisode).filter((e): e is Episode => e !== null);
  const signalCount = episodes.filter((e) => e.hasSignal).length;

  // Nothing to learn from clean approvals alone — just mark them processed.
  if (signalCount === 0) {
    await markLearned(rows.map((r) => r.id as string));
    return;
  }

  // Throttle the distiller: batch small signals, never run more than ~2x/hour.
  if (Date.now() - lastDistillAt < DISTILL_COOLDOWN_MS && signalCount < 3) return;
  if (signalCount < MIN_SIGNAL_TO_DISTILL) return;

  const { data: existing } = await supabase
    .from('support_facts')
    .select('id, content')
    .eq('brand_id', brandId)
    .eq('key', LESSONS_FACT_KEY)
    .maybeSingle();

  const lessons = await distill(episodes, existing?.content ?? '');
  if (!lessons) return;
  lastDistillAt = Date.now();

  const factRow = {
    brand_id: brandId,
    key: LESSONS_FACT_KEY,
    fact_type: 'brand',
    title: 'Autopilot learned lessons (auto-updated from reviewed runs)',
    content: lessons,
    priority: 117,
    locked: false,
    enabled: true,
    source: 'autopilot-learning',
    updated_at: new Date().toISOString(),
  };
  if (existing) {
    await supabase.from('support_facts').update(factRow).eq('id', existing.id);
  } else {
    await supabase.from('support_facts').insert(factRow);
  }

  await markLearned(rows.map((r) => r.id as string));
  console.log(`[autopilot-learning] ${slug}: distilled ${signalCount} signal episode(s) from ${episodes.length} reviewed plans → lessons updated (${lessons.length} chars)`);
}

function buildEpisode(row: { ticket_number: number; subject: string; metadata: unknown }): Episode | null {
  const meta = (row.metadata as Record<string, unknown>) || {};
  const plan = meta.autopilot as AutopilotPlan | undefined;
  if (!plan) return null;

  const history = Array.isArray(meta.autopilot_history) ? (meta.autopilot_history as AutopilotPlan[]) : [];
  const triage = (meta.ai_triage as { intent?: string } | undefined)?.intent;

  const instructions = [...history, plan]
    .map((p) => p.operator_instruction)
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0);

  const edited: Episode['edited_replies'] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const a of plan.actions as AutopilotAction[]) {
    if (a.type === 'send_reply' && a.params?.edited_by_reviewer) {
      edited.push({
        original: typeof a.params.original_reply_text === 'string' ? a.params.original_reply_text.slice(0, 1200) : undefined,
        final: String(a.params.reply_text ?? '').slice(0, 1200),
      });
    }
    if (a.status === 'skipped') skipped.push(`${a.type}: ${a.title}`);
    if (a.status === 'failed') failed.push(`${a.type}: ${a.result ?? 'failed'}`);
  }

  const hasSignal =
    plan.status === 'dismissed' || instructions.length > 0 || edited.length > 0 || skipped.length > 0 || failed.length > 0;

  return {
    ticket_number: row.ticket_number,
    subject: String(row.subject).slice(0, 90),
    intent: triage,
    outcome: plan.status,
    operator_instructions: instructions.map((s) => s.slice(0, 400)),
    edited_replies: edited,
    skipped_actions: skipped,
    failed_actions: failed,
    hasSignal,
  };
}

const DISTILL_TOOL: Anthropic.Tool = {
  name: 'update_lessons',
  description: 'Output the full updated lessons document.',
  input_schema: {
    type: 'object' as const,
    required: ['lessons'],
    properties: {
      lessons: { type: 'string', description: 'The complete updated lessons document (replaces the old one).' },
    },
  },
};

async function distill(episodes: Episode[], currentLessons: string): Promise<string | null> {
  try {
    const response = await anthropic.messages.create({
      model: DISTILL_MODEL,
      max_tokens: 1200,
      temperature: 0.1,
      system: `You maintain the "learned lessons" document for an AI support planner (Warm by Design). The document is injected into every future planning call, so it must be SHORT, general, and operational.

Rules for the document:
- Numbered list, max 15 lessons, max ~2200 characters total.
- Each lesson is an actionable methodology rule derived from how the human reviewer ACTUALLY corrected the AI: edits to drafts (what changed and why), instructions they typed, actions they unchecked, plans they dismissed, executions that failed.
- Generalize: "Keep delay replies under ~100 words" — not ticket-specific trivia. Cite a ticket number in parentheses as evidence when useful.
- MERGE with the existing document: keep still-valid lessons, strengthen repeated ones, drop ones contradicted by newer behavior, dedupe.
- Lessons must never contradict the brand's locked rules; they refine HOW to apply them.
- If an episode shows clean approval with no changes, treat it as confirmation that the current approach works — not a new lesson.`,
      messages: [{
        role: 'user',
        content: `## Current lessons document\n${currentLessons || '(empty — first run)'}\n\n## Newly reviewed episodes\n${JSON.stringify(episodes, null, 1).slice(0, 14000)}\n\nProduce the full updated lessons document.`,
      }],
      tools: [DISTILL_TOOL],
      tool_choice: { type: 'tool', name: 'update_lessons' },
    });

    const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const lessons = (toolUse?.input as { lessons?: string } | undefined)?.lessons;
    return typeof lessons === 'string' && lessons.trim() ? lessons.trim().slice(0, 3000) : null;
  } catch (err) {
    console.error('[autopilot-learning] distill failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function markLearned(ticketIds: string[]): Promise<void> {
  const now = new Date().toISOString();
  for (const id of ticketIds) {
    const { data: fresh } = await supabase.from('tickets').select('metadata').eq('id', id).single();
    const meta = { ...(((fresh?.metadata as Record<string, unknown>) ?? {}) || {}) };
    const plan = meta.autopilot as Record<string, unknown> | undefined;
    if (!plan) continue;
    meta.autopilot = { ...plan, learned_at: now };
    await supabase.from('tickets').update({ metadata: meta }).eq('id', id);
  }
}
