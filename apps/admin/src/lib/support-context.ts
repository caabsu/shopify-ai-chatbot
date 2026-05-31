import { supabase } from './supabase';

interface SupportFactRow {
  fact_type: string;
  title: string;
  content: string;
  priority: number;
  locked: boolean;
}

interface ProductSupportRow {
  slug: string;
  handle: string | null;
  title: string;
  product_type: string | null;
  collection: string | null;
  price: number | string | null;
  support_summary: string | null;
  metafields: Record<string, unknown> | null;
  search_text: string | null;
}

const STOP_WORDS = new Set([
  'about', 'after', 'before', 'customer', 'email', 'from', 'have', 'hello', 'lamp',
  'lamps', 'order', 'please', 'support', 'that', 'their', 'there', 'this', 'ticket',
  'warm', 'with', 'would', 'your',
]);

function safeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function tokensFor(text: string): string[] {
  const tokens = text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [];
  return [...new Set(tokens.filter((token) => !STOP_WORDS.has(token)))];
}

function scoreProduct(row: ProductSupportRow, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  const haystack = [
    row.slug,
    row.handle,
    row.title,
    row.product_type,
    row.collection,
    row.support_summary,
    row.search_text,
  ].filter(Boolean).join(' ').toLowerCase();

  return tokens.reduce((score, token) => {
    if (row.slug?.toLowerCase() === token || row.handle?.toLowerCase() === token) return score + 8;
    if (row.title.toLowerCase().includes(token)) return score + 5;
    if (haystack.includes(token)) return score + 1;
    return score;
  }, 0);
}

function formatProduct(row: ProductSupportRow): string {
  const metafields = row.metafields ?? {};
  const specs = (metafields.specs ?? {}) as Record<string, unknown>;
  const custom = (metafields.custom ?? {}) as Record<string, unknown>;
  const faq = Array.isArray(custom.faq) ? custom.faq.slice(0, 3) as Array<Record<string, unknown>> : [];

  const specParts = [
    ['Color temperature', specs.color_temperature],
    ['Bulb base', specs.bulb_base],
    ['Voltage', specs.voltage],
    ['Lumens', specs.lumens],
    ['CRI', specs.cri],
    ['Dimensions', [specs.height, specs.width, specs.depth].filter(Boolean).join(' x ')],
    ['Materials', specs.material],
    ['Assembly', specs.assembly],
    ['Switch', specs.switch_type],
  ]
    .map(([label, value]) => safeText(value) ? `${label}: ${safeText(value)}` : '')
    .filter(Boolean)
    .join('; ');

  const lines = [
    `Product: ${row.title}${row.handle ? ` (${row.handle})` : ''}`,
    `- Type: ${row.product_type || 'not listed'}${row.collection ? `; Collection: ${row.collection}` : ''}${row.price ? `; Price: $${row.price}` : ''}`,
    row.support_summary ? `- Summary: ${row.support_summary}` : '',
    specParts ? `- Metafields/specs: ${specParts}` : '',
    textArray(specs.highlights).length ? `- Highlights: ${textArray(specs.highlights).join(', ')}` : '',
    textArray(custom.ideal_rooms).length ? `- Ideal rooms: ${textArray(custom.ideal_rooms).join(', ')}` : '',
    safeText(custom.placement_rule) ? `- Placement: ${safeText(custom.placement_rule)}` : '',
    safeText(custom.care_instructions) ? `- Care: ${safeText(custom.care_instructions)}` : '',
    faq.length
      ? `- FAQ: ${faq.map((item) => `${safeText(item.question)} -> ${safeText(item.answer)}`).filter((item) => item !== ' -> ').join(' | ')}`
      : '',
  ].filter(Boolean);

  return lines.join('\n');
}

export async function loadSupportContext(brandId: string, queryText: string): Promise<string> {
  const sections: string[] = [];

  try {
    const { data, error } = await supabase
      .from('support_facts')
      .select('fact_type, title, content, priority, locked')
      .eq('brand_id', brandId)
      .eq('enabled', true)
      .order('priority', { ascending: false })
      .limit(30);

    if (!error && data && data.length > 0) {
      const facts = (data as SupportFactRow[])
        .map((fact) => `[${fact.locked ? 'LOCKED ' : ''}${fact.fact_type}] ${fact.title}: ${fact.content}`)
        .join('\n\n');
      sections.push(`SUPPORT FACTS (locked rules override stale docs and agent notes):\n${facts}`);
    }
  } catch (err) {
    console.warn('[support-context] support_facts unavailable:', err instanceof Error ? err.message : err);
  }

  try {
    const { data, error } = await supabase
      .from('product_support_data')
      .select('slug, handle, title, product_type, collection, price, support_summary, metafields, search_text')
      .eq('brand_id', brandId)
      .in('status', ['active', 'draft'])
      .limit(80);

    if (!error && data && data.length > 0) {
      const tokens = tokensFor(queryText);
      const scored = (data as ProductSupportRow[])
        .map((row) => ({ row, score: scoreProduct(row, tokens) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);

      if (scored.length > 0) {
        sections.push(
          `PRODUCT SUPPORT DATA (use exact values; do not expose supplier/source data):\n${scored.map((item) => formatProduct(item.row)).join('\n\n')}`,
        );
      }
    }
  } catch (err) {
    console.warn('[support-context] product_support_data unavailable:', err instanceof Error ? err.message : err);
  }

  return sections.length > 0 ? `\n\n${sections.join('\n\n---\n\n')}` : '';
}
