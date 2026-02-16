import { supabase } from '../config/supabase.js';
import type { KnowledgeDocument } from '../types/index.js';

export async function searchKnowledge(query: string): Promise<KnowledgeDocument[]> {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);

  // Use ilike to match against title and content
  // Search for each term in title or content
  let queryBuilder = supabase
    .from('knowledge_documents')
    .select()
    .eq('enabled', true);

  // Build an OR filter matching any term in title or content
  const orConditions = terms
    .map((term) => `title.ilike.%${term}%,content.ilike.%${term}%`)
    .join(',');

  if (orConditions) {
    queryBuilder = queryBuilder.or(orConditions);
  }

  const { data: rows, error } = await queryBuilder
    .order('priority', { ascending: false })
    .limit(5);

  if (error) {
    console.error('[knowledge.service] searchKnowledge error:', error.message);
    throw new Error('Failed to search knowledge base');
  }

  return (rows ?? []) as KnowledgeDocument[];
}

export async function getByCategory(category: string): Promise<KnowledgeDocument[]> {
  const { data: rows, error } = await supabase
    .from('knowledge_documents')
    .select()
    .eq('category', category)
    .eq('enabled', true)
    .order('priority', { ascending: false });

  if (error) {
    console.error('[knowledge.service] getByCategory error:', error.message);
    throw new Error('Failed to get documents by category');
  }

  return (rows ?? []) as KnowledgeDocument[];
}
