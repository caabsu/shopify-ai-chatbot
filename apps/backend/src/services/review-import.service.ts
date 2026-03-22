import { supabase } from '../config/supabase.js';
import type { ReviewImportResult } from '../types/index.js';

interface LooxRow {
  id?: string;
  product_handle?: string;
  rating?: string;
  title?: string;
  body?: string;
  author?: string;
  email?: string;
  status?: string;
  created_at?: string;
  img?: string;
  reply?: string;
  reply_author?: string;
  reply_date?: string;
}

// ── CSV Parser ─────────────────────────────────────────────────────────────

function parseCSV(csvText: string): LooxRow[] {
  // Strip BOM if present
  let text = csvText;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const lines = splitCSVLines(text);
  if (lines.length < 2) return [];

  const headers = parseCSVRow(lines[0]).map((h) => h.trim().toLowerCase());
  const rows: LooxRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVRow(line);
    const row: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }

    rows.push(row as unknown as LooxRow);
  }

  return rows;
}

function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
      } else {
        inQuotes = !inQuotes;
        current += char;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
        i++; // skip \r\n
      }
      lines.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    lines.push(current);
  }

  return lines;
}

function parseCSVRow(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
}

// ── Image Download ─────────────────────────────────────────────────────────

async function downloadImageToStorage(imageUrl: string, reviewId: string): Promise<string | null> {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      console.error(`[review-import] Failed to download image ${imageUrl}: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const buffer = Buffer.from(await response.arrayBuffer());

    const filename = `imports/${reviewId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error } = await supabase.storage
      .from('review-media')
      .upload(filename, buffer, { contentType, upsert: false });

    if (error) {
      console.error(`[review-import] Failed to upload image to storage:`, error.message);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('review-media')
      .getPublicUrl(filename);

    return urlData.publicUrl;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review-import] Image download failed:', message);
    return null;
  }
}

// ── Main Import ────────────────────────────────────────────────────────────

export async function importLooxCSV(
  csvText: string,
  brandId: string,
): Promise<ReviewImportResult> {
  const result: ReviewImportResult = {
    imported: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    const rows = parseCSV(csvText);

    if (rows.length === 0) {
      result.errors.push('CSV contains no data rows');
      return result;
    }

    // Process in batches of 20
    const batchSize = 20;
    for (let batchStart = 0; batchStart < rows.length; batchStart += batchSize) {
      const batch = rows.slice(batchStart, batchStart + batchSize);

      const promises = batch.map((row, index) =>
        processRow(row, brandId, batchStart + index + 1),
      );

      const batchResults = await Promise.allSettled(promises);

      for (const batchResult of batchResults) {
        if (batchResult.status === 'fulfilled') {
          const outcome = batchResult.value;
          if (outcome === 'imported') result.imported++;
          else if (outcome === 'skipped') result.skipped++;
          else {
            result.failed++;
            result.errors.push(outcome);
          }
        } else {
          result.failed++;
          result.errors.push(batchResult.reason instanceof Error ? batchResult.reason.message : String(batchResult.reason));
        }
      }

      console.log(`[review-import] Batch ${Math.floor(batchStart / batchSize) + 1} complete: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`);
    }

    console.log(`[review-import] Import complete for brand ${brandId}: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review-import] Import failed:', message);
    result.errors.push(`Import failed: ${message}`);
    return result;
  }
}

async function processRow(
  row: LooxRow,
  brandId: string,
  rowIndex: number,
): Promise<'imported' | 'skipped' | string> {
  try {
    const handle = row.product_handle?.trim();
    if (!handle) {
      return `Row ${rowIndex}: Missing product_handle`;
    }

    const rating = parseInt(row.rating ?? '', 10);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      return `Row ${rowIndex}: Invalid rating "${row.rating}"`;
    }

    const body = row.body?.trim();
    if (!body) {
      return `Row ${rowIndex}: Missing review body`;
    }

    const email = row.email?.trim();
    if (!email) {
      return `Row ${rowIndex}: Missing email`;
    }

    const importSourceId = row.id?.trim() || null;

    // Check for duplicate import
    if (importSourceId) {
      const { data: existing } = await supabase
        .from('reviews')
        .select('id')
        .eq('import_source_id', importSourceId)
        .eq('brand_id', brandId)
        .single();

      if (existing) return 'skipped';
    }

    // Resolve product
    const { data: product } = await supabase
      .from('products')
      .select('id, shopify_product_id')
      .eq('handle', handle)
      .eq('brand_id', brandId)
      .single();

    if (!product) {
      return `Row ${rowIndex}: Product not found for handle "${handle}"`;
    }

    // Map Loox status
    const looxStatus = row.status?.trim().toLowerCase();
    const status = looxStatus === 'active' || looxStatus === 'published' ? 'published' : 'pending';

    const submittedAt = row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString();

    const reviewRow = {
      product_id: product.id,
      shopify_product_id: product.shopify_product_id,
      shopify_order_id: null,
      customer_email: email,
      customer_name: row.author?.trim() || email.split('@')[0],
      customer_nickname: null,
      rating,
      title: row.title?.trim() || null,
      body,
      status,
      verified_purchase: false,
      incentivized: false,
      variant_title: null,
      source: 'import' as const,
      import_source_id: importSourceId,
      featured: false,
      helpful_count: 0,
      report_count: 0,
      published_at: status === 'published' ? submittedAt : null,
      submitted_at: submittedAt,
      brand_id: brandId,
    };

    const { data: created, error: createErr } = await supabase
      .from('reviews')
      .insert(reviewRow)
      .select('id')
      .single();

    if (createErr) {
      return `Row ${rowIndex}: Failed to insert review: ${createErr.message}`;
    }

    const reviewId = (created as Record<string, unknown>).id as string;

    // Handle image import
    if (row.img?.trim()) {
      const imageUrls = row.img.split(';').map((u) => u.trim()).filter(Boolean);
      for (let i = 0; i < imageUrls.length; i++) {
        const publicUrl = await downloadImageToStorage(imageUrls[i], reviewId);
        if (publicUrl) {
          await supabase
            .from('review_media')
            .insert({
              review_id: reviewId,
              storage_path: publicUrl,
              url: publicUrl,
              media_type: 'image',
              sort_order: i,
              file_size: null,
              width: null,
              height: null,
            });
        }
      }
    }

    // Handle reply import
    if (row.reply?.trim()) {
      const replyAuthor = row.reply_author?.trim() || 'Store Owner';
      await supabase
        .from('review_replies')
        .insert({
          review_id: reviewId,
          author_name: replyAuthor,
          author_email: null,
          body: row.reply.trim(),
          published: true,
        });
    }

    return 'imported';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Row ${rowIndex}: ${message}`;
  }
}
