import { supabase } from '../config/supabase.js';
import type { QuizSession, QuizEvent } from '../types/index.js';

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function createSession(data: {
  brand_id: string;
  session_id: string;
  concept: QuizSession['concept'];
  device_type?: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}): Promise<QuizSession> {
  const { data: row, error } = await supabase
    .from('quiz_sessions')
    .insert({
      brand_id: data.brand_id,
      session_id: data.session_id,
      concept: data.concept,
      device_type: data.device_type ?? null,
      referrer: data.referrer ?? null,
      utm_source: data.utm_source ?? null,
      utm_medium: data.utm_medium ?? null,
      utm_campaign: data.utm_campaign ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('[quiz.service] createSession error:', error.message);
    throw new Error('Failed to create quiz session');
  }

  return row as QuizSession;
}

export async function getSession(sessionId: string): Promise<QuizSession | null> {
  const { data: row, error } = await supabase
    .from('quiz_sessions')
    .select()
    .eq('session_id', sessionId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('[quiz.service] getSession error:', error.message);
    throw new Error('Failed to get quiz session');
  }

  return row as QuizSession;
}

export async function updateSession(
  sessionId: string,
  updates: Partial<Pick<QuizSession,
    'status' | 'current_step' | 'answers' | 'profile_key' | 'profile_name' |
    'email' | 'photo_uploaded' | 'photo_url' | 'render_url' | 'render_status' |
    'selection_mode' | 'selected_products' | 'recommended_products' |
    'cart_created' | 'converted' | 'completed_at'
  >>,
): Promise<QuizSession> {
  const { data: row, error } = await supabase
    .from('quiz_sessions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('session_id', sessionId)
    .select()
    .single();

  if (error) {
    console.error('[quiz.service] updateSession error:', error.message);
    throw new Error('Failed to update quiz session');
  }

  return row as QuizSession;
}

export async function listSessions(brandId: string, filters?: {
  status?: string;
  concept?: string;
  search?: string;
  page?: number;
  perPage?: number;
}): Promise<{ sessions: QuizSession[]; total: number; totalPages: number }> {
  const page = filters?.page ?? 1;
  const perPage = filters?.perPage ?? 20;
  const offset = (page - 1) * perPage;

  let query = supabase
    .from('quiz_sessions')
    .select('*', { count: 'exact' })
    .eq('brand_id', brandId);

  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.concept) query = query.eq('concept', filters.concept);
  if (filters?.search) query = query.or(`email.ilike.%${filters.search}%,profile_name.ilike.%${filters.search}%,session_id.ilike.%${filters.search}%`);

  const { data: rows, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + perPage - 1);

  if (error) {
    console.error('[quiz.service] listSessions error:', error.message);
    throw new Error('Failed to list quiz sessions');
  }

  const total = count ?? 0;
  return {
    sessions: (rows ?? []) as QuizSession[],
    total,
    totalPages: Math.ceil(total / perPage),
  };
}

// ── Events ───────────────────────────────────────────────────────────────────

export async function trackEvent(data: {
  brand_id: string;
  session_id: string;
  event_type: string;
  step?: string;
  data?: Record<string, unknown>;
  duration_ms?: number;
}): Promise<QuizEvent> {
  const { data: row, error } = await supabase
    .from('quiz_events')
    .insert({
      brand_id: data.brand_id,
      session_id: data.session_id,
      event_type: data.event_type,
      step: data.step ?? null,
      data: data.data ?? null,
      duration_ms: data.duration_ms ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('[quiz.service] trackEvent error:', error.message);
    throw new Error('Failed to track quiz event');
  }

  return row as QuizEvent;
}

export async function trackEvents(events: Array<{
  brand_id: string;
  session_id: string;
  event_type: string;
  step?: string;
  data?: Record<string, unknown>;
  duration_ms?: number;
}>): Promise<void> {
  const inserts = events.map((e) => ({
    brand_id: e.brand_id,
    session_id: e.session_id,
    event_type: e.event_type,
    step: e.step ?? null,
    data: e.data ?? null,
    duration_ms: e.duration_ms ?? null,
  }));

  const { error } = await supabase.from('quiz_events').insert(inserts);
  if (error) {
    console.error('[quiz.service] trackEvents error:', error.message);
    throw new Error('Failed to track quiz events');
  }
}

export async function getSessionEvents(sessionId: string): Promise<QuizEvent[]> {
  const { data: rows, error } = await supabase
    .from('quiz_events')
    .select()
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[quiz.service] getSessionEvents error:', error.message);
    throw new Error('Failed to get session events');
  }

  return (rows ?? []) as QuizEvent[];
}
