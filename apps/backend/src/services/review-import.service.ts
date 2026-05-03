import { supabase } from '../config/supabase.js';
import { createHash } from 'node:crypto';
import type { ReviewImportResult } from '../types/index.js';

interface LooxRow {
  id?: string;
  handle?: string;
  product_handle?: string;
  productid?: string;
  product_id?: string;
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
  photo_url?: string;
  variant?: string;
  verified_purchase?: string;
  orderid?: string;
  incentivized?: string;
  reply?: string;
  reply_author?: string;
  reply_date?: string;
  replied_at?: string;
}

interface ParsedCSVRow {
  lineNumber: number;
  row: LooxRow;
}

interface ProductLookup {
  id: string;
  shopify_product_id: string | null;
  handle: string;
}

interface PreparedReview {
  lineNumber: number;
  row: LooxRow;
  reviewRow: Record<string, unknown>;
  importSourceIds: string[];
  duplicateKey: string;
}

// ── CSV Parser ─────────────────────────────────────────────────────────────

function parseCSV(csvText: string): ParsedCSVRow[] {
  // Strip BOM if present
  let text = csvText;
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const lines = splitCSVLines(text);
  if (lines.length < 2) return [];

  const headers = parseCSVRow(lines[0]).map((h) => h.trim().toLowerCase());
  const rows: ParsedCSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVRow(line);
    const row: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? '';
    }

    rows.push({
      lineNumber: i + 1,
      row: row as unknown as LooxRow,
    });
  }

  return rows;
}

function splitCSVLines(text: string): string[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '\\' && inQuotes && i + 1 < text.length && text[i + 1] === '"') {
      current += char;
      current += '"';
      i++;
    } else if (char === '"') {
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

    if (char === '\\' && inQuotes && i + 1 < line.length && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
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
    const parsedRows = parseCSV(csvText);

    if (parsedRows.length === 0) {
      result.errors.push('CSV contains no data rows');
      return result;
    }

    const prepared = await prepareRows(parsedRows, brandId);
    if (prepared.errors.length > 0) {
      result.failed = prepared.errors.length;
      result.errors.push(...prepared.errors);
      return result;
    }

    const importedReviewIds: string[] = [];
    for (const preparedReview of prepared.reviews) {
      const outcome = await insertPreparedReview(preparedReview);
      if (outcome.status === 'skipped') {
        result.skipped++;
        continue;
      }
      if (outcome.status === 'failed') {
        result.failed++;
        result.errors.push(outcome.error);
        await rollbackImportedReviews(importedReviewIds);
        result.imported = 0;
        result.skipped = 0;
        result.errors.push('Import rolled back. No new reviews were saved.');
        return result;
      }

      importedReviewIds.push(outcome.reviewId);
      result.imported++;
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

async function prepareRows(
  parsedRows: ParsedCSVRow[],
  brandId: string,
): Promise<{ reviews: PreparedReview[]; errors: string[] }> {
  const errors: string[] = [];
  const handles = new Set<string>();
  const shopifyProductIds = new Set<string>();

  for (const { row } of parsedRows) {
    const handle = getProductHandle(row);
    if (handle) handles.add(handle);

    const shopifyProductId = getShopifyProductId(row);
    if (shopifyProductId) shopifyProductIds.add(shopifyProductId);
  }

  const productsByHandle = new Map<string, ProductLookup>();
  const productsByShopifyId = new Map<string, ProductLookup>();

  if (handles.size > 0) {
    const { data, error } = await supabase
      .from('products')
      .select('id, shopify_product_id, handle')
      .eq('brand_id', brandId)
      .in('handle', Array.from(handles));

    if (error) {
      return { reviews: [], errors: [`Failed to resolve products by handle: ${error.message}`] };
    }

    for (const product of (data ?? []) as ProductLookup[]) {
      productsByHandle.set(product.handle, product);
    }
  }

  if (shopifyProductIds.size > 0) {
    const { data, error } = await supabase
      .from('products')
      .select('id, shopify_product_id, handle')
      .eq('brand_id', brandId)
      .in('shopify_product_id', Array.from(shopifyProductIds));

    if (error) {
      return { reviews: [], errors: [`Failed to resolve products by Shopify ID: ${error.message}`] };
    }

    for (const product of (data ?? []) as ProductLookup[]) {
      if (product.shopify_product_id) productsByShopifyId.set(product.shopify_product_id, product);
    }
  }

  const prepared: PreparedReview[] = [];
  for (const { row, lineNumber } of parsedRows) {
    // Support both "handle" (actual Loox export) and "product_handle" column names
    const handle = getProductHandle(row);
    const shopifyProductId = getShopifyProductId(row);
    if (!handle && !shopifyProductId) {
      errors.push(`Row ${lineNumber}: Missing product handle or product ID`);
      continue;
    }

    const rating = parseInt(row.rating ?? '', 10);
    if (isNaN(rating) || rating < 1 || rating > 5) {
      errors.push(`Row ${lineNumber}: Invalid rating "${row.rating}"`);
      continue;
    }

    // Support both "review" (actual Loox export) and "body" column names
    const body = (row.review || row.body)?.trim();
    if (!body) {
      errors.push(`Row ${lineNumber}: Missing review body`);
      continue;
    }

    // Email is often empty in Loox exports — generate a placeholder if missing
    const email = row.email?.trim() || `imported-${row.id || lineNumber}@noreply.import`;

    const product =
      (handle ? productsByHandle.get(handle) : undefined) ||
      (shopifyProductId ? productsByShopifyId.get(shopifyProductId) : undefined);
    if (!product) {
      const productLabel = handle ? `handle "${handle}"` : `Shopify product ID "${shopifyProductId}"`;
      errors.push(`Row ${lineNumber}: Product not found for ${productLabel}`);
      continue;
    }

    // Map Loox status
    const looxStatus = row.status?.trim().toLowerCase();
    const status = mapReviewStatus(looxStatus);

    // Support both "date" (actual Loox) and "created_at" column names
    const dateStr = row.date || row.created_at;
    const submittedAt = parseDateOrError(dateStr, `Row ${lineNumber}: Invalid created_at/date "${dateStr}"`);
    if (typeof submittedAt !== 'string') {
      errors.push(submittedAt.error);
      continue;
    }

    const replyDate = row.replied_at || row.reply_date;
    if (replyDate?.trim()) {
      const parsedReplyDate = parseDateOrError(replyDate, `Row ${lineNumber}: Invalid replied_at/reply_date "${replyDate}"`);
      if (typeof parsedReplyDate !== 'string') {
        errors.push(parsedReplyDate.error);
        continue;
      }
    }

    // Support "full_name" (actual Loox) and "author"
    const customerName = (row.full_name || row.author)?.trim() || email.split('@')[0];
    const customerNickname = row.nickname?.trim() || null;

    // Map verified_purchase, incentivized, variant, orderId from actual Loox columns
    const verifiedPurchase = row.verified_purchase?.trim().toLowerCase() === 'true';
    const incentivized = row.incentivized?.trim().toLowerCase() === 'true';
    const variantTitle = row.variant?.trim() || null;
    const shopifyOrderId = row.orderid?.trim() || null;
    const importSourceIds = getImportSourceIds(row, brandId, product, email, body, submittedAt);
    const duplicateKey = getDuplicateKey(product.id, email, body, submittedAt);

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
      import_source_id: importSourceIds[0],
      featured: false,
      helpful_count: 0,
      report_count: 0,
      published_at: status === 'published' ? submittedAt : null,
      submitted_at: submittedAt,
      brand_id: brandId,
    };

    prepared.push({ lineNumber, row, reviewRow, importSourceIds, duplicateKey });
  }

  return { reviews: prepared, errors };
}

async function insertPreparedReview(
  prepared: PreparedReview,
): Promise<
  | { status: 'imported'; reviewId: string }
  | { status: 'skipped' }
  | { status: 'failed'; error: string }
> {
  try {
    const { data: existingBySource, error: existingBySourceErr } = await supabase
      .from('reviews')
      .select('id')
      .in('import_source_id', prepared.importSourceIds)
      .limit(1);

    if (existingBySourceErr) {
      return {
        status: 'failed',
        error: `Row ${prepared.lineNumber}: Failed to check existing import: ${existingBySourceErr.message}`,
      };
    }
    if ((existingBySource ?? []).length > 0) return { status: 'skipped' };

    const { data: possibleDuplicates, error: duplicateErr } = await supabase
      .from('reviews')
      .select('id, product_id, customer_email, body, submitted_at')
      .eq('brand_id', prepared.reviewRow.brand_id)
      .eq('source', 'import')
      .eq('product_id', prepared.reviewRow.product_id)
      .eq('customer_email', prepared.reviewRow.customer_email);

    if (duplicateErr) {
      return {
        status: 'failed',
        error: `Row ${prepared.lineNumber}: Failed to check duplicate review: ${duplicateErr.message}`,
      };
    }

    const alreadyImported = ((possibleDuplicates ?? []) as Array<Record<string, unknown>>).some((review) =>
      getDuplicateKey(
        String(review.product_id),
        String(review.customer_email),
        String(review.body),
        new Date(String(review.submitted_at)).toISOString(),
      ) === prepared.duplicateKey,
    );

    if (alreadyImported) return { status: 'skipped' };

    const { data: created, error: createErr } = await supabase
      .from('reviews')
      .insert(prepared.reviewRow)
      .select('id')
      .single();

    if (createErr) {
      return { status: 'failed', error: `Row ${prepared.lineNumber}: Failed to insert review: ${createErr.message}` };
    }

    const reviewId = (created as Record<string, unknown>).id as string;

    // Handle media import (images and videos)
    const mediaValue = prepared.row.img?.trim() || prepared.row.photo_url?.trim();
    if (mediaValue) {
      // Loox uses comma-separated URLs; also support semicolons
      const imageUrls = mediaValue.split(/[;,]/).map((u) => u.trim()).filter((u) => u.startsWith('http'));
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
    if (prepared.row.reply?.trim()) {
      const replyAuthor = prepared.row.reply_author?.trim() || 'Store Owner';
      const replyDate = prepared.row.replied_at || prepared.row.reply_date;
      const replyInsert: Record<string, unknown> = {
        review_id: reviewId,
        author_name: replyAuthor,
        author_email: null,
        body: prepared.row.reply.trim(),
        published: true,
      };
      if (replyDate?.trim()) {
        const createdAt = parseDateOrError(replyDate, `Row ${prepared.lineNumber}: Invalid replied_at/reply_date "${replyDate}"`);
        if (typeof createdAt !== 'string') {
          await rollbackImportedReviews([reviewId]);
          return { status: 'failed', error: createdAt.error };
        }
        replyInsert.created_at = createdAt;
      }
      const { error: replyErr } = await supabase
        .from('review_replies')
        .insert(replyInsert);
      if (replyErr) {
        await rollbackImportedReviews([reviewId]);
        return { status: 'failed', error: `Row ${prepared.lineNumber}: Failed to insert reply: ${replyErr.message}` };
      }
    }

    return { status: 'imported', reviewId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'failed', error: `Row ${prepared.lineNumber}: ${message}` };
  }
}

function getProductHandle(row: LooxRow): string | null {
  return (row.handle || row.product_handle)?.trim() || null;
}

function getShopifyProductId(row: LooxRow): string | null {
  return (row.productid || row.product_id)?.trim() || null;
}

function mapReviewStatus(status?: string): 'pending' | 'published' | 'rejected' | 'archived' {
  if (!status || status === 'active' || status === 'published') return 'published';
  if (status === 'rejected' || status === 'archived' || status === 'pending') return status;
  return 'pending';
}

function parseDateOrError(value: string | undefined, error: string): string | { error: string } {
  if (!value?.trim()) return new Date().toISOString();

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { error };

  return date.toISOString();
}

function getImportSourceIds(
  row: LooxRow,
  brandId: string,
  product: ProductLookup,
  email: string,
  body: string,
  submittedAt: string,
): string[] {
  const sourceId = row.id?.trim();
  if (sourceId) return [`${brandId}:loox:${sourceId}`, sourceId];

  return [`${brandId}:csv:${hashParts([
    product.shopify_product_id || product.id,
    email.toLowerCase(),
    body,
    submittedAt,
  ])}`];
}

function getDuplicateKey(productId: string, email: string, body: string, submittedAt: string): string {
  return hashParts([productId, email.toLowerCase(), body, submittedAt]);
}

function hashParts(parts: string[]): string {
  return createHash('sha256').update(parts.join('\u001f')).digest('hex').slice(0, 32);
}

async function rollbackImportedReviews(reviewIds: string[]): Promise<void> {
  if (reviewIds.length === 0) return;

  for (let i = 0; i < reviewIds.length; i += 200) {
    const batch = reviewIds.slice(i, i + 200);
    await supabase.from('review_media').delete().in('review_id', batch);
    await supabase.from('review_replies').delete().in('review_id', batch);
    await supabase.from('reviews').delete().in('id', batch);
  }
}
