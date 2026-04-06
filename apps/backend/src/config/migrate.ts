import { supabase } from './supabase.js';

export async function runMigrations(): Promise<void> {
  try {
    // Verify key columns exist by attempting a select
    const { error: rrErr } = await supabase
      .from('review_requests')
      .select('line_items')
      .limit(0);
    if (rrErr) {
      console.warn('[migrate] review_requests.line_items missing — run: ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS line_items jsonb DEFAULT NULL');
    }

    const { error: rvErr } = await supabase
      .from('reviews')
      .select('variant_title')
      .limit(0);
    if (rvErr) {
      console.warn('[migrate] reviews.variant_title missing — run: ALTER TABLE reviews ADD COLUMN IF NOT EXISTS variant_title text DEFAULT NULL');
    }

    console.log('[migrate] Schema check complete');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[migrate] Migration check warning (non-fatal):', msg);
  }
}
