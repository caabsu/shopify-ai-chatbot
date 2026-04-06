import postgres from 'postgres';
import { config } from './env.js';

export async function runMigrations(): Promise<void> {
  // Extract connection details from Supabase URL
  const ref = config.supabase.url.replace('https://', '').split('.')[0];

  const sql = postgres({
    host: `aws-0-us-west-1.pooler.supabase.com`,
    port: 6543,
    database: 'postgres',
    username: `postgres.${ref}`,
    password: config.supabase.serviceRoleKey,
    ssl: 'require',
    connect_timeout: 15,
  });

  try {
    // Add line_items jsonb to review_requests (for variant-aware order tracking)
    await sql`ALTER TABLE review_requests ADD COLUMN IF NOT EXISTS line_items jsonb DEFAULT NULL`;

    // Add variant_id and sku to reviews
    await sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS variant_id text DEFAULT NULL`;
    await sql`ALTER TABLE reviews ADD COLUMN IF NOT EXISTS sku text DEFAULT NULL`;

    console.log('[migrate] Schema up to date (line_items, variant_id, sku)');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Don't crash the server if migration fails — columns may already exist
    console.warn('[migrate] Migration warning (non-fatal):', msg);
  } finally {
    await sql.end();
  }
}
