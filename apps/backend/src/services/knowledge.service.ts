import { supabase } from '../config/supabase.js';
import type { KnowledgeDocument } from '../types/index.js';

export async function searchKnowledge(query: string, brandId?: string): Promise<KnowledgeDocument[]> {
  // Extract only alphanumeric words — strip emails, special chars, punctuation
  // that break PostgREST's filter parser (commas, @, etc.)
  const terms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);

  if (terms.length === 0) {
    // No meaningful terms — return top priority docs
    let fallback = supabase
      .from('knowledge_documents')
      .select()
      .eq('enabled', true);
    if (brandId) fallback = fallback.eq('brand_id', brandId);
    const { data: rows } = await fallback
      .order('priority', { ascending: false })
      .limit(5);
    return (rows ?? []) as KnowledgeDocument[];
  }

  // Limit to 5 most relevant terms to avoid huge filters
  const searchTerms = terms.slice(0, 5);

  let queryBuilder = supabase
    .from('knowledge_documents')
    .select()
    .eq('enabled', true);

  if (brandId) queryBuilder = queryBuilder.eq('brand_id', brandId);

  // Build an OR filter matching any term in title or content
  const orConditions = searchTerms
    .map((term) => `title.ilike.%${term}%,content.ilike.%${term}%`)
    .join(',');

  queryBuilder = queryBuilder.or(orConditions);

  const { data: rows, error } = await queryBuilder
    .order('priority', { ascending: false })
    .limit(5);

  if (error) {
    console.error('[knowledge.service] searchKnowledge error:', error.message);
    // Fallback: return top priority docs instead of throwing
    let fallback = supabase
      .from('knowledge_documents')
      .select()
      .eq('enabled', true);
    if (brandId) fallback = fallback.eq('brand_id', brandId);
    const { data: fallbackRows } = await fallback
      .order('priority', { ascending: false })
      .limit(5);
    return (fallbackRows ?? []) as KnowledgeDocument[];
  }

  return (rows ?? []) as KnowledgeDocument[];
}

export async function getByCategory(category: string, brandId?: string): Promise<KnowledgeDocument[]> {
  let query = supabase
    .from('knowledge_documents')
    .select()
    .eq('category', category)
    .eq('enabled', true);

  if (brandId) query = query.eq('brand_id', brandId);

  const { data: rows, error } = await query
    .order('priority', { ascending: false });

  if (error) {
    console.error('[knowledge.service] getByCategory error:', error.message);
    throw new Error('Failed to get documents by category');
  }

  return (rows ?? []) as KnowledgeDocument[];
}
