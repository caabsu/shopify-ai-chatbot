import { supabase } from '../config/supabase.js';
import type { QuizProductPool } from '../types/index.js';

// ── Product Pool CRUD ────────────────────────────────────────────────────────

/** Normalize product_handles from DB — may be a JSON string (double-encoded) or a real array */
function normalizeHandles(val: unknown): string[] {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; }
    catch { return []; }
  }
  return [];
}

function normalizePool(row: Record<string, unknown>): QuizProductPool {
  return {
    ...row,
    product_handles: normalizeHandles(row.product_handles),
    profile_keys: Array.isArray(row.profile_keys) ? row.profile_keys : [],
  } as QuizProductPool;
}

export async function listPools(brandId: string): Promise<QuizProductPool[]> {
  const { data: rows, error } = await supabase
    .from('quiz_product_pools')
    .select()
    .eq('brand_id', brandId)
    .order('priority', { ascending: false });

  if (error) {
    console.error('[quiz-recommendation] listPools error:', error.message);
    throw new Error('Failed to list product pools');
  }

  return (rows ?? []).map((r) => normalizePool(r as Record<string, unknown>));
}

export async function getPool(id: string): Promise<QuizProductPool | null> {
  const { data: row, error } = await supabase
    .from('quiz_product_pools')
    .select()
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    console.error('[quiz-recommendation] getPool error:', error.message);
    throw new Error('Failed to get product pool');
  }

  return row as QuizProductPool;
}

export async function createPool(data: {
  brand_id: string;
  name: string;
  description?: string;
  profile_keys?: string[];
  product_handles?: string[];
  priority?: number;
}): Promise<QuizProductPool> {
  const { data: row, error } = await supabase
    .from('quiz_product_pools')
    .insert({
      brand_id: data.brand_id,
      name: data.name,
      description: data.description ?? null,
      profile_keys: data.profile_keys ?? [],
      product_handles: data.product_handles ?? [],
      priority: data.priority ?? 0,
    })
    .select()
    .single();

  if (error) {
    console.error('[quiz-recommendation] createPool error:', error.message);
    throw new Error('Failed to create product pool');
  }

  return normalizePool(row as Record<string, unknown>);
}

export async function updatePool(id: string, updates: Partial<Pick<QuizProductPool,
  'name' | 'description' | 'profile_keys' | 'product_handles' | 'priority' | 'enabled'
>>): Promise<QuizProductPool> {
  const payload: Record<string, unknown> = { ...updates, updated_at: new Date().toISOString() };

  const { data: row, error } = await supabase
    .from('quiz_product_pools')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[quiz-recommendation] updatePool error:', error.message);
    throw new Error('Failed to update product pool');
  }

  return normalizePool(row as Record<string, unknown>);
}

export async function deletePool(id: string): Promise<void> {
  const { error } = await supabase
    .from('quiz_product_pools')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[quiz-recommendation] deletePool error:', error.message);
    throw new Error('Failed to delete product pool');
  }
}

// ── Recommendation Engine ────────────────────────────────────────────────────

export async function getRecommendations(brandId: string, profileKey: string): Promise<string[]> {
  // Fetch all enabled pools for this brand
  const { data: pools, error } = await supabase
    .from('quiz_product_pools')
    .select()
    .eq('brand_id', brandId)
    .eq('enabled', true)
    .order('priority', { ascending: false });

  if (error) {
    console.error('[quiz-recommendation] getRecommendations error:', error.message);
    return [];
  }

  // Find pools that match this profile key
  const matchingPools = (pools ?? []).filter((pool: QuizProductPool) =>
    pool.profile_keys.length === 0 || pool.profile_keys.includes(profileKey),
  );

  // Collect unique product handles, prioritizing higher-priority pools
  const handles: string[] = [];
  const seen = new Set<string>();

  for (const pool of matchingPools) {
    const poolHandles = normalizeHandles(pool.product_handles);

    for (const handle of poolHandles) {
      if (!seen.has(handle)) {
        seen.add(handle);
        handles.push(handle);
      }
    }
  }

  return handles;
}
