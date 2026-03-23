import { supabase } from '../config/supabase.js';
import type { ReviewImportResult } from '../types/index.js';

interface LooxRow {
  id?: string;
  handle?: string;
  product_handle?: string;
  productid?: string;
  rating?: string;
  title?: string;
  body?: string;
  review?: string;
  author?: string;
  full_name?: string;
  nickname?: string;
  email?: string;
  status?: string;
  created_at?: string;
  date?: string;
  img?: string;
  variant?: string;
  verified_purchase?: string;
  orderid?: string;
  incentivized?: string;
  reply?: string;
  reply_author?: string;
  reply_date?: string;
  replied_at?: string;
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
      current += char;
      if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
        // Escaped quote "" — pass both through, stay in quotes
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
        i++;
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
    // Support both "handle" (actual Loox export) and "product_handle" column names
    const handle = (row.handle || row.product_handle)?.trim();
    if (!handle) {
      return `Row ${rowIndex}: Missing product handle`;
    }

    const rating = parseInt(row.rating ?? '', 10);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      return `Row ${rowIndex}: Invalid rating "${row.rating}"`;
    }

    // Support both "review" (actual Loox export) and "body" column names
    const body = (row.review || row.body)?.trim();
    if (!body) {
      return `Row ${rowIndex}: Missing review body`;
    }

    // Email is often empty in Loox exports — generate a placeholder if missing
    const email = row.email?.trim() || `imported-${row.id || rowIndex}@noreply.import`;

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

    // Support both "date" (actual Loox) and "created_at" column names
    const dateStr = row.date || row.created_at;
    const submittedAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

    // Support "full_name" (actual Loox) and "author"
    const customerName = (row.full_name || row.author)?.trim() || email.split('@')[0];
    const customerNickname = row.nickname?.trim() || null;

    // Map verified_purchase, incentivized, variant, orderId from actual Loox columns
    const verifiedPurchase = row.verified_purchase?.trim().toLowerCase() === 'true';
    const incentivized = row.incentivized?.trim().toLowerCase() === 'true';
    const variantTitle = row.variant?.trim() || null;
    const shopifyOrderId = row.orderid?.trim() || null;

    const reviewRow = {
      product_id: product.id,
      shopify_product_id: product.shopify_product_id,
      shopify_order_id: shopifyOrderId,
      customer_email: email,
      customer_name: customerName,
      customer_nickname: customerNickname,
      rating,
      title: row.title?.trim() || null,
      body,
      status,
      verified_purchase: verifiedPurchase,
      incentivized,
      variant_title: variantTitle,
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

    // Handle media import (images and videos)
    if (row.img?.trim()) {
      // Loox uses comma-separated URLs; also support semicolons
      const imageUrls = row.img.split(/[;,]/).map((u) => u.trim()).filter((u) => u.startsWith('http'));
      for (let i = 0; i < imageUrls.length; i++) {
        const mediaUrl = imageUrls[i];
        const isVideo = /\.(mp4|mov|webm|avi)(\?|$)/i.test(mediaUrl);
        const publicUrl = await downloadImageToStorage(mediaUrl, reviewId);
        if (publicUrl) {
          await supabase
            .from('review_media')
            .insert({
              review_id: reviewId,
              storage_path: publicUrl,
              url: publicUrl,
              media_type: isVideo ? 'video' : 'image',
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
      const replyDate = row.replied_at || row.reply_date;
      const replyInsert: Record<string, unknown> = {
        review_id: reviewId,
        author_name: replyAuthor,
        author_email: null,
        body: row.reply.trim(),
        published: true,
      };
      if (replyDate?.trim()) {
        replyInsert.created_at = new Date(replyDate).toISOString();
      }
      await supabase
        .from('review_replies')
        .insert(replyInsert);
    }

    return 'imported';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Row ${rowIndex}: ${message}`;
  }
}
