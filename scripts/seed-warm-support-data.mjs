#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const BRAND_SLUG = 'warm-by-design';
const PRODUCT_PAGE_SIZE = 50;

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function normalizeShopifyShop(shop) {
  return String(shop || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.myshopify\.com$/i, '')
    .toLowerCase();
}

function settingString(settings, key) {
  const value = settings?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function cleanText(value) {
  if (!value) return '';
  return String(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactObject(value) {
  if (Array.isArray(value)) return value.map(compactObject).filter((item) => item !== undefined);
  if (!value || typeof value !== 'object') return value ?? undefined;

  const entries = Object.entries(value)
    .map(([key, item]) => [key, compactObject(item)])
    .filter(([, item]) => item !== undefined && item !== '' && !(Array.isArray(item) && item.length === 0));

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function coerceMetafieldValue(metafield) {
  if (metafield.type === 'number_integer') return Number.parseInt(metafield.value, 10);
  if (metafield.type === 'number_decimal') return Number.parseFloat(metafield.value);
  if (metafield.type === 'boolean') return metafield.value === 'true';
  if (
    metafield.type.startsWith('list.') ||
    metafield.type === 'json' ||
    metafield.type === 'rich_text_field'
  ) {
    try {
      return JSON.parse(metafield.value);
    } catch {
      return metafield.value;
    }
  }
  return metafield.value;
}

function getByKey(byKey, keys) {
  for (const key of keys) {
    const item = byKey[key];
    if (item?.value !== undefined && item.value !== null && item.value !== '') return item.value;
  }
  return undefined;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return value.split(',').map((item) => item.trim()).filter(Boolean);
    }
  }
  return undefined;
}

function formatValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return cleanText(value);
  if (Array.isArray(value)) return value.map(formatValue).filter(Boolean).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildMetafieldIndexes(raw) {
  const byKey = Object.fromEntries(
    raw.map((field) => [
      `${field.namespace}.${field.key}`,
      {
        value: coerceMetafieldValue(field),
        raw_value: field.value,
        type: field.type,
        id: field.id,
        updated_at: field.updatedAt ?? null,
      },
    ]),
  );

  const byNamespace = {};
  for (const [fullKey, value] of Object.entries(byKey)) {
    const [namespace, key] = fullKey.split('.', 2);
    byNamespace[namespace] ??= {};
    byNamespace[namespace][key] = value;
  }

  return { byKey, byNamespace };
}

function buildStructuredMetafields(product, rawMetafields) {
  const { byKey, byNamespace } = buildMetafieldIndexes(rawMetafields);

  const specs = compactObject({
    height: getByKey(byKey, ['specs.height', 'custom.height']),
    width: getByKey(byKey, ['specs.width', 'custom.width']),
    depth: getByKey(byKey, ['specs.depth', 'custom.depth']),
    shade_diameter: getByKey(byKey, ['specs.shade_diameter', 'custom.shade_diameter']),
    shade_height: getByKey(byKey, ['specs.shade_height', 'custom.shade_height']),
    weight: getByKey(byKey, ['specs.weight', 'custom.weight']),
    material: getByKey(byKey, ['specs.material', 'custom.material']),
    body_material: getByKey(byKey, ['specs.body_material', 'custom.body_material']),
    shade_material: getByKey(byKey, ['specs.shade_material', 'custom.shade_material']),
    finish: getByKey(byKey, ['specs.finish', 'custom.finish']),
    color: getByKey(byKey, ['specs.color', 'custom.color']),
    color_temperature: getByKey(byKey, ['specs.color_temperature', 'custom.color_temperature']),
    cri: getByKey(byKey, ['specs.cri', 'custom.cri']),
    lumens: getByKey(byKey, ['specs.lumens', 'custom.lumens']),
    voltage: getByKey(byKey, ['specs.voltage', 'custom.voltage']),
    bulb_base: getByKey(byKey, ['specs.bulb_base', 'custom.bulb_base']),
    installation_type: getByKey(byKey, ['specs.installation_type', 'custom.installation_type']),
    switch_type: getByKey(byKey, ['specs.switch_type', 'custom.switch_type']),
    assembly: getByKey(byKey, ['specs.assembly', 'custom.assembly']),
    certifications: getByKey(byKey, ['specs.certifications', 'custom.certifications']),
    highlights: asArray(getByKey(byKey, ['specs.highlights', 'custom.highlights'])),
  }) || {};

  const custom = compactObject({
    short_description: getByKey(byKey, ['custom.short_description', 'descriptors.subtitle']),
    care_instructions: getByKey(byKey, ['custom.care_instructions']),
    faq: getByKey(byKey, ['custom.faq']),
    layer: getByKey(byKey, ['custom.layer']),
    ideal_rooms: asArray(getByKey(byKey, ['custom.ideal_rooms'])),
    placement_rule: getByKey(byKey, ['custom.placement_rule']),
    placement_note: getByKey(byKey, ['custom.placement_note']),
    feature_cards: getByKey(byKey, ['custom.feature_cards']),
  }) || {};

  return {
    specs,
    custom,
    seo: compactObject(product.seo) || {},
    shopify: {
      fetched_at: new Date().toISOString(),
      count: rawMetafields.length,
      raw: rawMetafields,
      by_key: byKey,
      by_namespace: byNamespace,
    },
  };
}

function buildSupportSummary(product, metafields) {
  const specs = metafields.specs ?? {};
  const custom = metafields.custom ?? {};
  const parts = [
    formatValue(custom.short_description) || cleanText(product.descriptionHtml),
    product.productType ? `Type: ${product.productType}.` : '',
    formatValue(custom.layer) ? `Layer: ${formatValue(custom.layer)}.` : '',
    formatValue(specs.color_temperature) ? `Color temperature: ${formatValue(specs.color_temperature)}.` : '',
    formatValue(specs.bulb_base) ? `Bulb base: ${formatValue(specs.bulb_base)}.` : '',
    formatValue(specs.material) ? `Materials: ${formatValue(specs.material)}.` : '',
    formatValue(custom.placement_rule) ? `Placement: ${formatValue(custom.placement_rule)}` : '',
  ].filter(Boolean);

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function primaryPrice(product) {
  const amount = product.priceRangeV2?.minVariantPrice?.amount;
  const parsed = Number.parseFloat(amount);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSearchText(product, metafields, supportSummary) {
  const variantsText = product.variants.edges
    .map(({ node }) => `${node.title} ${node.sku ?? ''} ${node.price ?? ''}`)
    .join(' ');
  const collectionsText = product.collections.edges
    .map(({ node }) => `${node.title} ${node.handle}`)
    .join(' ');
  const metafieldsText = metafields.shopify.raw
    .map((field) => `${field.namespace}.${field.key} ${field.value}`)
    .join(' ');

  return [
    product.id,
    product.title,
    product.handle,
    product.status,
    product.vendor,
    product.productType,
    ...(product.tags ?? []),
    collectionsText,
    cleanText(product.descriptionHtml),
    supportSummary,
    variantsText,
    JSON.stringify(metafields.specs ?? {}),
    JSON.stringify(metafields.custom ?? {}),
    metafieldsText,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

function toProductSupportRow(product, rawMetafields) {
  const metafields = buildStructuredMetafields(product, rawMetafields);
  const supportSummary = buildSupportSummary(product, metafields);
  const variants = product.variants.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    sku: node.sku,
    price: node.price,
    inventory_quantity: node.inventoryQuantity,
    selected_options: node.selectedOptions,
    image_url: node.image?.url ?? null,
  }));

  const collections = product.collections.edges.map(({ node }) => ({
    id: node.id,
    title: node.title,
    handle: node.handle,
  }));

  return {
    slug: product.handle,
    handle: product.handle,
    shopify_product_id: product.id,
    shopify_variant_id: variants[0]?.id ?? null,
    title: product.title,
    product_type: product.productType || null,
    collection: collections[0]?.title ?? null,
    price: primaryPrice(product),
    status: product.status?.toLowerCase() ?? 'active',
    support_summary: supportSummary,
    metafields,
    product_data: {
      source: 'shopify_admin_graphql',
      fetched_at: new Date().toISOString(),
      product: {
        id: product.id,
        title: product.title,
        handle: product.handle,
        status: product.status,
        vendor: product.vendor,
        productType: product.productType,
        tags: product.tags,
        descriptionHtml: product.descriptionHtml,
        onlineStoreUrl: product.onlineStoreUrl,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        publishedAt: product.publishedAt,
        seo: product.seo,
        featuredImage: product.featuredImage,
        priceRangeV2: product.priceRangeV2,
        options: product.options,
        collections,
        variants,
      },
    },
    variants,
    search_text: buildSearchText(product, metafields, supportSummary),
    source_path: null,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

async function getShopifyToken(brand) {
  const settings = brand.settings || {};
  const shop = normalizeShopifyShop(brand.shopify_shop);
  const clientId = settingString(settings, 'shopify_client_id') || settingString(settings, 'shopifyClientId');
  const clientSecret = settingString(settings, 'shopify_client_secret') || settingString(settings, 'shopifyClientSecret');

  if (!shop || !clientId || !clientSecret) {
    throw new Error('Warm by Design Shopify credentials are not configured in brand settings.');
  }

  const res = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify token request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return { shop, token: data.access_token };
}

async function shopifyGraphql(shopify, query, variables) {
  const apiVersion = process.env.SHOPIFY_API_VERSION || '2025-01';
  const res = await fetch(`https://${shopify.shop}.myshopify.com/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': shopify.token,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify GraphQL request failed (${res.status}): ${text}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${json.errors.map((error) => error.message).join('; ')}`);
  }
  return json.data;
}

async function fetchProducts(shopify) {
  const query = `
    query ProductsForSupport($first: Int!, $after: String) {
      products(first: $first, after: $after) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            title
            handle
            status
            vendor
            productType
            tags
            descriptionHtml
            onlineStoreUrl
            createdAt
            updatedAt
            publishedAt
            seo { title description }
            featuredImage { url altText }
            priceRangeV2 {
              minVariantPrice { amount currencyCode }
              maxVariantPrice { amount currencyCode }
            }
            options { id name values }
            collections(first: 20) {
              edges { node { id title handle } }
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  inventoryQuantity
                  selectedOptions { name value }
                  image { url altText }
                }
              }
            }
          }
        }
      }
    }
  `;

  const products = [];
  let after = null;
  do {
    const data = await shopifyGraphql(shopify, query, { first: PRODUCT_PAGE_SIZE, after });
    const page = data.products;
    products.push(...page.edges.map((edge) => edge.node));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return products;
}

async function fetchProductMetafields(shopify, productId) {
  const query = `
    query ProductMetafields($id: ID!, $after: String) {
      product(id: $id) {
        metafields(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              namespace
              key
              value
              type
              updatedAt
            }
          }
        }
      }
    }
  `;

  const raw = [];
  let after = null;
  do {
    const data = await shopifyGraphql(shopify, query, { id: productId, after });
    const metafields = data?.product?.metafields;
    if (!metafields) return raw;
    raw.push(...metafields.edges.map((edge) => edge.node));
    after = metafields.pageInfo.hasNextPage ? metafields.pageInfo.endCursor : null;
  } while (after);

  return raw;
}

async function buildRowsFromShopify(shopify) {
  const products = await fetchProducts(shopify);
  const rows = [];
  let metafieldCount = 0;

  for (const product of products) {
    const metafields = await fetchProductMetafields(shopify, product.id);
    metafieldCount += metafields.length;
    rows.push(toProductSupportRow(product, metafields));
  }

  return { rows, metafieldCount };
}

async function deleteStaleSupportRows(supabase, brandId, liveRows) {
  const liveIds = new Set(liveRows.map((row) => row.shopify_product_id));
  const { data: existing, error } = await supabase
    .from('product_support_data')
    .select('id, shopify_product_id, slug')
    .eq('brand_id', brandId);

  if (error) throw new Error(`Failed to list existing product support rows: ${error.message}`);

  const staleIds = (existing ?? [])
    .filter((row) => !row.shopify_product_id || !liveIds.has(row.shopify_product_id))
    .map((row) => row.id);

  if (staleIds.length === 0) return 0;

  const { error: deleteError } = await supabase
    .from('product_support_data')
    .delete()
    .in('id', staleIds);

  if (deleteError) throw new Error(`Failed to delete stale product support rows: ${deleteError.message}`);
  return staleIds.length;
}

async function upsertProductSupportRows(supabase, brandId, rows) {
  const rowsWithBrand = rows.map((row) => ({ ...row, brand_id: brandId }));
  for (let i = 0; i < rowsWithBrand.length; i += 25) {
    const batch = rowsWithBrand.slice(i, i + 25);
    const { error } = await supabase
      .from('product_support_data')
      .upsert(batch, { onConflict: 'brand_id,slug' });

    if (error) throw new Error(`Failed to upsert product support data: ${error.message}`);
  }
}

async function upsertProductsRows(supabase, brandId, rows) {
  // The `products` table stores numeric Shopify IDs (matching apps/backend/src/services/product-sync.service.ts).
  // Writing GIDs here would bypass the (brand_id, shopify_product_id) upsert key and create duplicate rows.
  const stripGid = (value) => (typeof value === 'string' ? value.replace(/^gid:\/\/shopify\/[^/]+\//, '') : value);

  const productsRows = rows.map((row) => ({
    brand_id: brandId,
    shopify_product_id: stripGid(row.shopify_product_id),
    title: row.title,
    handle: row.handle || row.slug,
    product_type: row.product_type,
    vendor: row.product_data.product.vendor,
    status: row.status,
    featured_image_url: row.product_data.product.featuredImage?.url ?? null,
    variants: Array.isArray(row.variants)
      ? row.variants.map((v) => ({ ...v, id: stripGid(v.id) }))
      : row.variants,
    tags: row.product_data.product.tags ?? [],
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  for (let i = 0; i < productsRows.length; i += 50) {
    const batch = productsRows.slice(i, i + 50);
    const { error } = await supabase
      .from('products')
      .upsert(batch, { onConflict: 'brand_id,shopify_product_id' });

    if (error) throw new Error(`Failed to upsert products table: ${error.message}`);
  }
}

async function main() {
  loadEnvFile(path.join(process.cwd(), '.env'));
  loadEnvFile(path.join(process.cwd(), 'apps', 'backend', '.env'));
  loadEnvFile(path.join(process.cwd(), 'apps', 'admin', '.env.local'));
  loadEnvFile(path.join(process.cwd(), 'apps', 'admin', '.env.production'));

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: brand, error: brandError } = await supabase
    .from('brands')
    .select('id, shopify_shop, settings')
    .eq('slug', BRAND_SLUG)
    .single();

  if (brandError || !brand) {
    throw new Error(`Warm by Design brand not found: ${brandError?.message || 'no row'}`);
  }

  const shopify = await getShopifyToken(brand);
  const { rows, metafieldCount } = await buildRowsFromShopify(shopify);

  if (dryRun) {
    console.log(`Fetched ${rows.length} Warm by Design products directly from Shopify Admin (${shopify.shop}.myshopify.com).`);
    console.log(`Fetched ${metafieldCount} Shopify product metafields.`);
    console.log(rows.slice(0, 5).map((row) => ({
      slug: row.slug,
      title: row.title,
      status: row.status,
      product_type: row.product_type,
      metafield_count: row.metafields.shopify.count,
      color_temperature: row.metafields.specs?.color_temperature,
      bulb_base: row.metafields.specs?.bulb_base,
    })));
    return;
  }

  await upsertProductSupportRows(supabase, brand.id, rows);
  const deleted = await deleteStaleSupportRows(supabase, brand.id, rows);
  await upsertProductsRows(supabase, brand.id, rows);

  console.log(`Fetched ${rows.length} Warm by Design products directly from Shopify Admin (${shopify.shop}.myshopify.com).`);
  console.log(`Fetched ${metafieldCount} Shopify product metafields.`);
  console.log(`Seeded ${rows.length} product_support_data rows from Shopify only.`);
  console.log(`Removed ${deleted} stale non-Shopify/local product_support_data rows.`);
  console.log(`Upserted ${rows.length} Shopify products into products.`);
}

main().catch((err) => {
  console.error(`[seed-warm-support-data.mjs] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
