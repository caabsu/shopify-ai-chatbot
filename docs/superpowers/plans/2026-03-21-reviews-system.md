# Reviews System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete product reviews system with Shopify sync, email collection, storefront widget, admin dashboard, and AI analytics.

**Architecture:** Follows the existing Returns section pattern exactly — backend services (Express + Supabase), admin dashboard (Next.js), embeddable widget (Vite IIFE). Multi-tenant via `brand_id`. Media in Supabase Storage.

**Tech Stack:** TypeScript, Express, Next.js 15, React 19, Supabase, Vite, Resend, Claude API, Shopify Admin API (GraphQL)

**Spec:** `docs/superpowers/specs/2026-03-21-reviews-system-design.md`

---

## Task 1: Database Schema

**Files:**
- Reference: `apps/backend/src/config/supabase.ts` (Supabase client)

Create all review tables in Supabase via MCP or SQL.

- [ ] **Step 1: Create `products` table**

```sql
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id text UNIQUE NOT NULL,
  title text NOT NULL,
  handle text NOT NULL,
  product_type text,
  vendor text,
  status text DEFAULT 'active',
  featured_image_url text,
  variants jsonb DEFAULT '[]',
  tags text[] DEFAULT '{}',
  synced_at timestamptz DEFAULT now(),
  brand_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_products_brand_handle ON products(brand_id, handle);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON products FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 2: Create `reviews` table**

```sql
CREATE TABLE reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id),
  shopify_product_id text,
  shopify_order_id text,
  customer_email text NOT NULL,
  customer_name text NOT NULL,
  customer_nickname text,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  title text,
  body text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending','published','rejected','archived')),
  verified_purchase boolean DEFAULT false,
  incentivized boolean DEFAULT false,
  variant_title text,
  source text DEFAULT 'organic' CHECK (source IN ('import','email_request','organic','manual')),
  import_source_id text,
  featured boolean DEFAULT false,
  helpful_count integer DEFAULT 0,
  report_count integer DEFAULT 0,
  published_at timestamptz,
  submitted_at timestamptz DEFAULT now(),
  brand_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_reviews_product_status ON reviews(product_id, status, created_at DESC);
CREATE INDEX idx_reviews_brand_status ON reviews(brand_id, status);
CREATE INDEX idx_reviews_customer_email ON reviews(customer_email);
CREATE INDEX idx_reviews_shopify_order ON reviews(shopify_order_id);
CREATE UNIQUE INDEX idx_reviews_import_source ON reviews(import_source_id) WHERE import_source_id IS NOT NULL;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON reviews FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 3: Create `review_media` table**

```sql
CREATE TABLE review_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  url text NOT NULL,
  media_type text DEFAULT 'image' CHECK (media_type IN ('image','video')),
  sort_order integer DEFAULT 0,
  file_size integer,
  width integer,
  height integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_review_media_review ON review_media(review_id, sort_order);
ALTER TABLE review_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON review_media FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 4: Create `review_replies` table**

```sql
CREATE TABLE review_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL UNIQUE REFERENCES reviews(id) ON DELETE CASCADE,
  author_name text NOT NULL,
  author_email text,
  body text NOT NULL,
  published boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE review_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON review_replies FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 5: Create `review_requests` table**

```sql
CREATE TABLE review_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_order_id text NOT NULL,
  shopify_customer_id text,
  customer_email text NOT NULL,
  customer_name text,
  product_ids jsonb NOT NULL DEFAULT '[]',
  status text DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','reminded','completed','cancelled','bounced','expired')),
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz,
  reminder_scheduled_for timestamptz,
  reminder_sent_at timestamptz,
  completed_at timestamptz,
  token text UNIQUE NOT NULL,
  brand_id uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_review_requests_status_scheduled ON review_requests(status, scheduled_for);
CREATE INDEX idx_review_requests_order ON review_requests(shopify_order_id);
ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON review_requests FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 6: Create `review_settings` table**

```sql
CREATE TABLE review_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid UNIQUE NOT NULL,
  auto_publish boolean DEFAULT true,
  auto_publish_min_rating integer DEFAULT 1,
  auto_publish_verified_only boolean DEFAULT false,
  profanity_filter boolean DEFAULT true,
  request_enabled boolean DEFAULT true,
  request_delay_days integer DEFAULT 14,
  reminder_enabled boolean DEFAULT true,
  reminder_delay_days integer DEFAULT 7,
  incentive_enabled boolean DEFAULT false,
  incentive_type text,
  incentive_value text,
  sender_name text,
  sender_email text,
  review_form_fields jsonb DEFAULT '{}',
  widget_design jsonb DEFAULT '{}',
  reviews_per_page integer DEFAULT 10,
  default_sort text DEFAULT 'newest',
  show_verified_badge boolean DEFAULT true,
  show_incentivized_disclosure boolean DEFAULT true,
  incentivized_disclosure_text text DEFAULT 'This reviewer received an incentive for their honest review.',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE review_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON review_settings FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 7: Create `review_analytics_cache` table**

```sql
CREATE TABLE review_analytics_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  product_id uuid,
  analysis_type text NOT NULL CHECK (analysis_type IN ('sentiment','themes','trends','actions','summary')),
  data jsonb NOT NULL,
  review_count integer NOT NULL,
  analyzed_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX idx_review_analytics_lookup ON review_analytics_cache(brand_id, product_id, analysis_type);
ALTER TABLE review_analytics_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON review_analytics_cache FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 8: Create `review_email_templates` table**

```sql
CREATE TABLE review_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL,
  template_type text NOT NULL CHECK (template_type IN ('request','reminder','thank_you')),
  subject text NOT NULL,
  body_html text NOT NULL,
  enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(brand_id, template_type)
);

ALTER TABLE review_email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for service role" ON review_email_templates FOR ALL USING (true) WITH CHECK (true);
```

- [ ] **Step 9: Create Supabase Storage bucket for review media**

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('review-media', 'review-media', true);

CREATE POLICY "Public read access" ON storage.objects FOR SELECT USING (bucket_id = 'review-media');
CREATE POLICY "Service role upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'review-media');
CREATE POLICY "Service role delete" ON storage.objects FOR DELETE USING (bucket_id = 'review-media');
```

- [ ] **Step 10: Seed default email templates**

```sql
-- Use a placeholder brand_id; the system will create per-brand on first access
-- These serve as default templates that get cloned for new brands

INSERT INTO review_email_templates (brand_id, template_type, subject, body_html) VALUES
('00000000-0000-0000-0000-000000000000', 'request',
 'How are you enjoying your {{product_title}}?',
 '<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #333; margin-bottom: 8px;">Hi {{customer_name}},</h2>
  <p style="color: #666; line-height: 1.6;">We hope you''re loving your <strong>{{product_title}}</strong>! Your feedback helps other customers and helps us improve.</p>
  <div style="text-align: center; margin: 32px 0;">
    <a href="{{review_link}}" style="display: inline-block; padding: 14px 32px; background: #18181b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 500; letter-spacing: 0.5px;">WRITE A REVIEW</a>
  </div>
  <p style="color: #999; font-size: 13px;">Thank you for your purchase!</p>
</div>'),

('00000000-0000-0000-0000-000000000000', 'reminder',
 'Still thinking about your {{product_title}}?',
 '<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #333; margin-bottom: 8px;">Hi {{customer_name}},</h2>
  <p style="color: #666; line-height: 1.6;">We''d love to hear your thoughts on your <strong>{{product_title}}</strong>. It only takes a minute!</p>
  <div style="text-align: center; margin: 32px 0;">
    <a href="{{review_link}}" style="display: inline-block; padding: 14px 32px; background: #18181b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 500; letter-spacing: 0.5px;">SHARE YOUR EXPERIENCE</a>
  </div>
  <p style="color: #999; font-size: 13px;">Thank you!</p>
</div>'),

('00000000-0000-0000-0000-000000000000', 'thank_you',
 'Thank you for your review!',
 '<div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <h2 style="color: #333; margin-bottom: 8px;">Thank you, {{customer_name}}!</h2>
  <p style="color: #666; line-height: 1.6;">We appreciate you taking the time to review your <strong>{{product_title}}</strong>. Your feedback helps our community!</p>
  <p style="color: #999; font-size: 13px;">— The {{brand_name}} Team</p>
</div>');
```

- [ ] **Step 11: Commit**

```bash
git add docs/
git commit -m "feat(reviews): add database schema and design spec"
```

---

## Task 2: TypeScript Types

**Files:**
- Modify: `apps/backend/src/types/index.ts`

- [ ] **Step 1: Add review type definitions**

Add these types at the end of the existing types file:

```typescript
// ── Reviews ──────────────────────────────────────

export interface Product {
  id: string;
  shopify_product_id: string;
  title: string;
  handle: string;
  product_type: string | null;
  vendor: string | null;
  status: string;
  featured_image_url: string | null;
  variants: ProductVariant[];
  tags: string[];
  synced_at: string;
  brand_id: string;
  created_at: string;
  updated_at: string;
  review_count?: number;
  average_rating?: number;
}

export interface ProductVariant {
  id: string;
  title: string;
  price: string;
  sku: string | null;
}

export interface Review {
  id: string;
  product_id: string;
  shopify_product_id: string | null;
  shopify_order_id: string | null;
  customer_email: string;
  customer_name: string;
  customer_nickname: string | null;
  rating: number;
  title: string | null;
  body: string;
  status: 'pending' | 'published' | 'rejected' | 'archived';
  verified_purchase: boolean;
  incentivized: boolean;
  variant_title: string | null;
  source: 'import' | 'email_request' | 'organic' | 'manual';
  import_source_id: string | null;
  featured: boolean;
  helpful_count: number;
  report_count: number;
  published_at: string | null;
  submitted_at: string;
  brand_id: string;
  created_at: string;
  updated_at: string;
  media?: ReviewMedia[];
  reply?: ReviewReply | null;
  product?: Product;
}

export interface ReviewMedia {
  id: string;
  review_id: string;
  storage_path: string;
  url: string;
  media_type: 'image' | 'video';
  sort_order: number;
  file_size: number | null;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface ReviewReply {
  id: string;
  review_id: string;
  author_name: string;
  author_email: string | null;
  body: string;
  published: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReviewRequest {
  id: string;
  shopify_order_id: string;
  shopify_customer_id: string | null;
  customer_email: string;
  customer_name: string | null;
  product_ids: string[];
  status: 'scheduled' | 'sent' | 'reminded' | 'completed' | 'cancelled' | 'bounced' | 'expired';
  scheduled_for: string;
  sent_at: string | null;
  reminder_scheduled_for: string | null;
  reminder_sent_at: string | null;
  completed_at: string | null;
  token: string;
  brand_id: string;
  created_at: string;
}

export interface ReviewSettings {
  id: string;
  brand_id: string;
  auto_publish: boolean;
  auto_publish_min_rating: number;
  auto_publish_verified_only: boolean;
  profanity_filter: boolean;
  request_enabled: boolean;
  request_delay_days: number;
  reminder_enabled: boolean;
  reminder_delay_days: number;
  incentive_enabled: boolean;
  incentive_type: string | null;
  incentive_value: string | null;
  sender_name: string | null;
  sender_email: string | null;
  review_form_fields: Record<string, unknown>;
  widget_design: ReviewWidgetDesign;
  reviews_per_page: number;
  default_sort: string;
  show_verified_badge: boolean;
  show_incentivized_disclosure: boolean;
  incentivized_disclosure_text: string;
  created_at: string;
  updated_at: string;
}

export interface ReviewWidgetDesign {
  starColor: string;
  starStyle: 'filled' | 'outlined';
  backgroundColor: string;
  textColor: string;
  headingColor: string;
  headingFontFamily: string;
  bodyFontFamily: string;
  fontSize: 'small' | 'medium' | 'large';
  borderRadius: 'sharp' | 'rounded' | 'pill';
  cardStyle: 'bordered' | 'shadow' | 'minimal';
  buttonStyle: 'outlined' | 'filled' | 'minimal';
  buttonText: string;
  headerText: string;
  reviewsPerPage: number;
  defaultSort: 'newest' | 'oldest' | 'highest' | 'lowest' | 'most_helpful';
  showVerifiedBadge: boolean;
  showVariant: boolean;
  showDate: boolean;
  showPhotos: boolean;
  layout: 'grid' | 'list';
}

export interface ReviewEmailTemplate {
  id: string;
  brand_id: string;
  template_type: 'request' | 'reminder' | 'thank_you';
  subject: string;
  body_html: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReviewAnalyticsCache {
  id: string;
  brand_id: string;
  product_id: string | null;
  analysis_type: 'sentiment' | 'themes' | 'trends' | 'actions' | 'summary';
  data: Record<string, unknown>;
  review_count: number;
  analyzed_at: string;
  expires_at: string;
}

export interface ReviewSummary {
  average_rating: number;
  total_count: number;
  verified_count: number;
  distribution: { stars: number; count: number }[];
}

export interface ReviewImportResult {
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface ModerationResult {
  action: 'publish' | 'pending' | 'reject';
  reasons: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/types/index.ts
git commit -m "feat(reviews): add TypeScript type definitions"
```

---

## Task 3: Product Sync Service

**Files:**
- Create: `apps/backend/src/services/product-sync.service.ts`
- Reference: `apps/backend/src/services/shopify-auth.service.ts` (token management)
- Reference: `apps/backend/src/services/shopify-admin.service.ts` (GraphQL pattern)

- [ ] **Step 1: Create product sync service**

```typescript
import { supabase } from '../config/supabase.js';
import { getShopifyAccessToken } from './shopify-auth.service.js';
import { config } from '../config/env.js';
import type { Product, ProductVariant } from '../types/index.js';

const SHOPIFY_GRAPHQL_URL = `https://${config.shopify.shop}.myshopify.com/admin/api/${config.shopify.apiVersion}/graphql.json`;

interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  productType: string;
  vendor: string;
  status: string;
  featuredImage: { url: string } | null;
  tags: string[];
  variants: { edges: { node: { id: string; title: string; price: string; sku: string | null } }[] };
}

function extractNumericId(gid: string): string {
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1] : gid;
}

async function shopifyGraphQL(query: string, variables?: Record<string, unknown>): Promise<unknown> {
  const token = await getShopifyAccessToken();
  const res = await fetch(SHOPIFY_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify API error: ${res.status}`);
  const json = await res.json() as { data?: unknown; errors?: { message: string }[] };
  if (json.errors?.length) throw new Error(`Shopify GraphQL: ${json.errors[0].message}`);
  return json.data;
}

export async function fullSync(brandId: string): Promise<{ synced: number; errors: string[] }> {
  console.log('[product-sync] Starting full product sync');
  let cursor: string | null = null;
  let synced = 0;
  const errors: string[] = [];

  do {
    const query = `
      query ($cursor: String) {
        products(first: 50, after: $cursor) {
          edges {
            cursor
            node {
              id title handle productType vendor status
              featuredImage { url }
              tags
              variants(first: 100) {
                edges { node { id title price sku } }
              }
            }
          }
          pageInfo { hasNextPage }
        }
      }
    `;
    const data = await shopifyGraphQL(query, { cursor }) as {
      products: {
        edges: { cursor: string; node: ShopifyProduct }[];
        pageInfo: { hasNextPage: boolean };
      };
    };

    for (const edge of data.products.edges) {
      const p = edge.node;
      cursor = edge.cursor;
      try {
        const variants: ProductVariant[] = p.variants.edges.map(v => ({
          id: extractNumericId(v.node.id),
          title: v.node.title,
          price: v.node.price,
          sku: v.node.sku,
        }));

        const { error } = await supabase.from('products').upsert({
          shopify_product_id: extractNumericId(p.id),
          title: p.title,
          handle: p.handle,
          product_type: p.productType || null,
          vendor: p.vendor || null,
          status: p.status.toLowerCase(),
          featured_image_url: p.featuredImage?.url || null,
          variants,
          tags: p.tags,
          synced_at: new Date().toISOString(),
          brand_id: brandId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'shopify_product_id' });

        if (error) {
          errors.push(`${p.handle}: ${error.message}`);
        } else {
          synced++;
        }
      } catch (err) {
        errors.push(`${p.handle}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (!data.products.pageInfo.hasNextPage) cursor = null;
  } while (cursor);

  console.log(`[product-sync] Synced ${synced} products, ${errors.length} errors`);
  return { synced, errors };
}

export async function handleProductWebhook(
  topic: string,
  payload: Record<string, unknown>,
  brandId: string,
): Promise<void> {
  const shopifyId = String(payload.id);

  if (topic === 'products/delete') {
    const { error } = await supabase.from('products').delete().eq('shopify_product_id', shopifyId);
    if (error) console.error('[product-sync] Delete error:', error.message);
    else console.log(`[product-sync] Deleted product ${shopifyId}`);
    return;
  }

  // products/create or products/update
  const p = payload as Record<string, unknown>;
  const variants: ProductVariant[] = Array.isArray(p.variants)
    ? (p.variants as Record<string, unknown>[]).map(v => ({
        id: String(v.id),
        title: String(v.title || ''),
        price: String(v.price || '0'),
        sku: v.sku ? String(v.sku) : null,
      }))
    : [];

  const images = p.images as Record<string, unknown>[] | undefined;
  const featuredImage = images?.[0]?.src ? String(images[0].src) : null;
  const tags = typeof p.tags === 'string' ? (p.tags as string).split(', ').filter(Boolean) : [];

  const { error } = await supabase.from('products').upsert({
    shopify_product_id: shopifyId,
    title: String(p.title || ''),
    handle: String(p.handle || ''),
    product_type: p.product_type ? String(p.product_type) : null,
    vendor: p.vendor ? String(p.vendor) : null,
    status: String(p.status || 'active').toLowerCase(),
    featured_image_url: featuredImage,
    variants,
    tags,
    synced_at: new Date().toISOString(),
    brand_id: brandId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shopify_product_id' });

  if (error) console.error('[product-sync] Upsert error:', error.message);
  else console.log(`[product-sync] ${topic === 'products/create' ? 'Created' : 'Updated'} product ${shopifyId}`);
}

export async function getProducts(brandId: string): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select()
    .eq('brand_id', brandId)
    .order('title', { ascending: true });
  if (error) throw new Error(`Failed to get products: ${error.message}`);
  return (data ?? []) as Product[];
}

export async function getProductByHandle(handle: string, brandId: string): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .select()
    .eq('brand_id', brandId)
    .eq('handle', handle)
    .single();
  if (error && error.code === 'PGRST116') return null;
  if (error) throw new Error(`Failed to get product: ${error.message}`);
  return data as Product;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/services/product-sync.service.ts
git commit -m "feat(reviews): add product sync service with Shopify webhook support"
```

---

## Task 4: Review Settings Service

**Files:**
- Create: `apps/backend/src/services/review-settings.service.ts`
- Reference: `apps/backend/src/services/return-settings.service.ts`

- [ ] **Step 1: Create review settings service**

```typescript
import { supabase } from '../config/supabase.js';
import type { ReviewSettings, ReviewWidgetDesign } from '../types/index.js';

const cache = new Map<string, { data: ReviewSettings; expiresAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

const DEFAULT_WIDGET_DESIGN: ReviewWidgetDesign = {
  starColor: '#C4A265',
  starStyle: 'filled',
  backgroundColor: '#ffffff',
  textColor: '#333333',
  headingColor: '#C4A265',
  headingFontFamily: '',
  bodyFontFamily: '',
  fontSize: 'medium',
  borderRadius: 'rounded',
  cardStyle: 'bordered',
  buttonStyle: 'outlined',
  buttonText: 'WRITE A REVIEW',
  headerText: 'CUSTOMER REVIEWS',
  reviewsPerPage: 10,
  defaultSort: 'newest',
  showVerifiedBadge: true,
  showVariant: true,
  showDate: true,
  showPhotos: true,
  layout: 'grid',
};

const DEFAULTS: Omit<ReviewSettings, 'id' | 'brand_id' | 'created_at' | 'updated_at'> = {
  auto_publish: true,
  auto_publish_min_rating: 1,
  auto_publish_verified_only: false,
  profanity_filter: true,
  request_enabled: true,
  request_delay_days: 14,
  reminder_enabled: true,
  reminder_delay_days: 7,
  incentive_enabled: false,
  incentive_type: null,
  incentive_value: null,
  sender_name: null,
  sender_email: null,
  review_form_fields: {},
  widget_design: DEFAULT_WIDGET_DESIGN,
  reviews_per_page: 10,
  default_sort: 'newest',
  show_verified_badge: true,
  show_incentivized_disclosure: true,
  incentivized_disclosure_text: 'This reviewer received an incentive for their honest review.',
};

export async function getSettings(brandId: string): Promise<ReviewSettings> {
  const cached = cache.get(brandId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const { data, error } = await supabase
    .from('review_settings')
    .select()
    .eq('brand_id', brandId)
    .single();

  if (error && error.code === 'PGRST116') {
    // No settings yet — return defaults with brand_id
    const defaults = {
      id: '',
      brand_id: brandId,
      ...DEFAULTS,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as ReviewSettings;
    return defaults;
  }

  if (error) throw new Error(`Failed to get review settings: ${error.message}`);

  const settings = {
    ...DEFAULTS,
    ...data,
    widget_design: { ...DEFAULT_WIDGET_DESIGN, ...(data.widget_design || {}) },
  } as ReviewSettings;

  cache.set(brandId, { data: settings, expiresAt: Date.now() + CACHE_TTL });
  return settings;
}

export async function updateSettings(
  brandId: string,
  updates: Partial<ReviewSettings>,
): Promise<ReviewSettings> {
  const { id, brand_id, created_at, ...allowed } = updates as Record<string, unknown>;
  const payload = {
    brand_id: brandId,
    ...allowed,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('review_settings')
    .upsert(payload, { onConflict: 'brand_id' })
    .select()
    .single();

  if (error) throw new Error(`Failed to update review settings: ${error.message}`);

  cache.delete(brandId);
  return { ...DEFAULTS, ...data, widget_design: { ...DEFAULT_WIDGET_DESIGN, ...(data.widget_design || {}) } } as ReviewSettings;
}

export async function getWidgetDesign(brandId: string): Promise<ReviewWidgetDesign> {
  const settings = await getSettings(brandId);
  return settings.widget_design;
}

export async function updateWidgetDesign(
  brandId: string,
  design: Partial<ReviewWidgetDesign>,
): Promise<ReviewWidgetDesign> {
  const current = await getSettings(brandId);
  const merged = { ...current.widget_design, ...design };
  await updateSettings(brandId, { widget_design: merged } as Partial<ReviewSettings>);
  return merged;
}

export { DEFAULT_WIDGET_DESIGN, DEFAULTS as DEFAULT_REVIEW_SETTINGS };
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/services/review-settings.service.ts
git commit -m "feat(reviews): add review settings service with caching"
```

---

## Task 5: Review Moderation Service

**Files:**
- Create: `apps/backend/src/services/review-moderation.service.ts`

- [ ] **Step 1: Create moderation service**

```typescript
import type { ReviewSettings, ModerationResult } from '../types/index.js';

// Basic profanity list — extend as needed
const PROFANITY_LIST = [
  'fuck', 'shit', 'damn', 'ass', 'bitch', 'bastard', 'crap',
  'dick', 'piss', 'cunt', 'whore', 'slut',
];

interface ReviewInput {
  rating: number;
  body: string;
  title?: string | null;
  verified_purchase: boolean;
  customer_email: string;
}

export function evaluateReview(review: ReviewInput, settings: ReviewSettings): ModerationResult {
  const reasons: string[] = [];

  // Check minimum rating
  if (review.rating < settings.auto_publish_min_rating) {
    reasons.push(`Rating ${review.rating} below minimum ${settings.auto_publish_min_rating}`);
  }

  // Check verified purchase requirement
  if (settings.auto_publish_verified_only && !review.verified_purchase) {
    reasons.push('Not a verified purchase');
  }

  // Profanity filter
  if (settings.profanity_filter) {
    const text = `${review.title || ''} ${review.body}`.toLowerCase();
    const found = PROFANITY_LIST.filter(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      return regex.test(text);
    });
    if (found.length > 0) {
      reasons.push(`Profanity detected: ${found.join(', ')}`);
    }
  }

  // Spam detection: very short reviews
  if (review.body.trim().length < 5) {
    reasons.push('Review body too short (less than 5 characters)');
  }

  // Spam detection: excessive caps
  const capsRatio = (review.body.match(/[A-Z]/g) || []).length / review.body.length;
  if (review.body.length > 20 && capsRatio > 0.7) {
    reasons.push('Excessive capitalization detected');
  }

  if (!settings.auto_publish) {
    return { action: 'pending', reasons: ['Manual approval required'] };
  }

  if (reasons.length > 0) {
    return { action: 'pending', reasons };
  }

  return { action: 'publish', reasons: [] };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/services/review-moderation.service.ts
git commit -m "feat(reviews): add review moderation service"
```

---

## Task 6: Core Review Service

**Files:**
- Create: `apps/backend/src/services/review.service.ts`

- [ ] **Step 1: Create review service**

```typescript
import { supabase } from '../config/supabase.js';
import type { Review, ReviewMedia, ReviewReply, ReviewSummary } from '../types/index.js';
import { getSettings } from './review-settings.service.js';
import { evaluateReview } from './review-moderation.service.js';

export async function getReviewsByProduct(
  handle: string,
  brandId: string,
  opts: { page?: number; perPage?: number; sort?: string; status?: string } = {},
): Promise<{ reviews: Review[]; total: number; page: number; totalPages: number }> {
  const page = opts.page || 1;
  const perPage = opts.perPage || 10;
  const status = opts.status || 'published';
  const offset = (page - 1) * perPage;

  // Get product by handle
  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('handle', handle)
    .eq('brand_id', brandId)
    .single();

  if (!product) return { reviews: [], total: 0, page, totalPages: 0 };

  let query = supabase
    .from('reviews')
    .select('*', { count: 'exact' })
    .eq('product_id', product.id)
    .eq('status', status);

  // Sorting
  const sort = opts.sort || 'newest';
  switch (sort) {
    case 'oldest': query = query.order('created_at', { ascending: true }); break;
    case 'highest': query = query.order('rating', { ascending: false }).order('created_at', { ascending: false }); break;
    case 'lowest': query = query.order('rating', { ascending: true }).order('created_at', { ascending: false }); break;
    case 'most_helpful': query = query.order('helpful_count', { ascending: false }).order('created_at', { ascending: false }); break;
    default: query = query.order('created_at', { ascending: false }); break;
  }

  query = query.range(offset, offset + perPage - 1);
  const { data: reviews, error, count } = await query;

  if (error) throw new Error(`Failed to get reviews: ${error.message}`);

  // Load media and replies
  const reviewIds = (reviews ?? []).map(r => r.id);
  let mediaMap: Record<string, ReviewMedia[]> = {};
  let replyMap: Record<string, ReviewReply> = {};

  if (reviewIds.length > 0) {
    const [mediaRes, replyRes] = await Promise.all([
      supabase.from('review_media').select().in('review_id', reviewIds).order('sort_order'),
      supabase.from('review_replies').select().in('review_id', reviewIds).eq('published', true),
    ]);

    if (mediaRes.data) {
      mediaMap = mediaRes.data.reduce((acc: Record<string, ReviewMedia[]>, m) => {
        if (!acc[m.review_id]) acc[m.review_id] = [];
        acc[m.review_id].push(m as ReviewMedia);
        return acc;
      }, {});
    }

    if (replyRes.data) {
      replyMap = replyRes.data.reduce((acc: Record<string, ReviewReply>, r) => {
        acc[r.review_id] = r as ReviewReply;
        return acc;
      }, {});
    }
  }

  const enriched = (reviews ?? []).map(r => ({
    ...r,
    media: mediaMap[r.id] || [],
    reply: replyMap[r.id] || null,
  })) as Review[];

  return {
    reviews: enriched,
    total: count ?? 0,
    page,
    totalPages: Math.ceil((count ?? 0) / perPage),
  };
}

export async function getReviewSummary(handle: string, brandId: string): Promise<ReviewSummary> {
  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('handle', handle)
    .eq('brand_id', brandId)
    .single();

  if (!product) {
    return { average_rating: 0, total_count: 0, verified_count: 0, distribution: [5,4,3,2,1].map(s => ({ stars: s, count: 0 })) };
  }

  const { data: reviews } = await supabase
    .from('reviews')
    .select('rating, verified_purchase')
    .eq('product_id', product.id)
    .eq('status', 'published');

  if (!reviews || reviews.length === 0) {
    return { average_rating: 0, total_count: 0, verified_count: 0, distribution: [5,4,3,2,1].map(s => ({ stars: s, count: 0 })) };
  }

  const total_count = reviews.length;
  const verified_count = reviews.filter(r => r.verified_purchase).length;
  const average_rating = Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / total_count) * 10) / 10;

  const distMap: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of reviews) distMap[r.rating]++;
  const distribution = [5, 4, 3, 2, 1].map(stars => ({ stars, count: distMap[stars] }));

  return { average_rating, total_count, verified_count, distribution };
}

export async function submitReview(data: {
  product_handle: string;
  customer_email: string;
  customer_name: string;
  rating: number;
  title?: string;
  body: string;
  variant_title?: string;
  source?: string;
  token?: string;
  brand_id: string;
}): Promise<Review> {
  // Look up product
  const { data: product } = await supabase
    .from('products')
    .select()
    .eq('handle', data.product_handle)
    .eq('brand_id', data.brand_id)
    .single();

  if (!product) throw new Error('Product not found');

  // Check for verified purchase via token
  let verified = false;
  let shopifyOrderId: string | null = null;
  let source = data.source || 'organic';

  if (data.token) {
    const { data: request } = await supabase
      .from('review_requests')
      .select()
      .eq('token', data.token)
      .single();

    if (request && request.status !== 'completed' && request.status !== 'cancelled') {
      verified = true;
      shopifyOrderId = request.shopify_order_id;
      source = 'email_request';

      // Mark request as completed
      await supabase
        .from('review_requests')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', request.id);
    }
  }

  // Run moderation
  const settings = await getSettings(data.brand_id);
  const modResult = evaluateReview({
    rating: data.rating,
    body: data.body,
    title: data.title || null,
    verified_purchase: verified,
    customer_email: data.customer_email,
  }, settings);

  const status = modResult.action === 'publish' ? 'published' : modResult.action === 'reject' ? 'rejected' : 'pending';
  const now = new Date().toISOString();

  const { data: review, error } = await supabase
    .from('reviews')
    .insert({
      product_id: product.id,
      shopify_product_id: product.shopify_product_id,
      shopify_order_id: shopifyOrderId,
      customer_email: data.customer_email,
      customer_name: data.customer_name,
      customer_nickname: data.customer_name.split(' ')[0] + ' ' + (data.customer_name.split(' ').pop()?.[0] || '') + '.',
      rating: data.rating,
      title: data.title || null,
      body: data.body,
      status,
      verified_purchase: verified,
      variant_title: data.variant_title || null,
      source,
      published_at: status === 'published' ? now : null,
      submitted_at: now,
      brand_id: data.brand_id,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to submit review: ${error.message}`);

  console.log(`[review] Submitted review ${review.id} for ${product.handle}, status: ${status}`);
  return review as Review;
}

export async function getReviewById(id: string): Promise<Review | null> {
  const { data, error } = await supabase.from('reviews').select().eq('id', id).single();
  if (error && error.code === 'PGRST116') return null;
  if (error) throw new Error(`Failed to get review: ${error.message}`);

  const [mediaRes, replyRes, productRes] = await Promise.all([
    supabase.from('review_media').select().eq('review_id', id).order('sort_order'),
    supabase.from('review_replies').select().eq('review_id', id).single(),
    supabase.from('products').select().eq('id', data.product_id).single(),
  ]);

  return {
    ...data,
    media: (mediaRes.data ?? []) as ReviewMedia[],
    reply: replyRes.error ? null : (replyRes.data as ReviewReply),
    product: productRes.error ? undefined : productRes.data,
  } as Review;
}

export async function updateReview(id: string, updates: Partial<Review>): Promise<Review> {
  const allowed = ['status', 'featured', 'title', 'body', 'rating', 'verified_purchase', 'incentivized'];
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if ((updates as Record<string, unknown>)[key] !== undefined) {
      payload[key] = (updates as Record<string, unknown>)[key];
    }
  }

  // Set published_at when publishing
  if (payload.status === 'published') {
    const existing = await getReviewById(id);
    if (existing && !existing.published_at) {
      payload.published_at = new Date().toISOString();
    }
  }

  const { data, error } = await supabase
    .from('reviews')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update review: ${error.message}`);
  return data as Review;
}

export async function deleteReview(id: string): Promise<void> {
  const { error } = await supabase.from('reviews').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete review: ${error.message}`);
}

export async function bulkAction(ids: string[], action: 'publish' | 'reject' | 'archive' | 'delete'): Promise<number> {
  if (action === 'delete') {
    const { error } = await supabase.from('reviews').delete().in('id', ids);
    if (error) throw new Error(`Bulk delete failed: ${error.message}`);
    return ids.length;
  }

  const statusMap: Record<string, string> = { publish: 'published', reject: 'rejected', archive: 'archived' };
  const payload: Record<string, unknown> = {
    status: statusMap[action],
    updated_at: new Date().toISOString(),
  };
  if (action === 'publish') payload.published_at = new Date().toISOString();

  const { error } = await supabase.from('reviews').update(payload).in('id', ids);
  if (error) throw new Error(`Bulk ${action} failed: ${error.message}`);
  return ids.length;
}

export async function markHelpful(id: string): Promise<void> {
  const { error } = await supabase.rpc('increment_field', {
    table_name: 'reviews',
    row_id: id,
    field_name: 'helpful_count',
  });
  // Fallback if RPC doesn't exist
  if (error) {
    const { data } = await supabase.from('reviews').select('helpful_count').eq('id', id).single();
    if (data) {
      await supabase.from('reviews').update({ helpful_count: (data.helpful_count || 0) + 1 }).eq('id', id);
    }
  }
}

export async function reportReview(id: string): Promise<void> {
  const { data } = await supabase.from('reviews').select('report_count').eq('id', id).single();
  if (data) {
    const newCount = (data.report_count || 0) + 1;
    const updates: Record<string, unknown> = { report_count: newCount };
    // Auto-flag for moderation if 3+ reports
    if (newCount >= 3) updates.status = 'pending';
    await supabase.from('reviews').update(updates).eq('id', id);
  }
}

// Reply management
export async function createReply(reviewId: string, authorName: string, body: string, authorEmail?: string): Promise<ReviewReply> {
  const { data, error } = await supabase
    .from('review_replies')
    .upsert({
      review_id: reviewId,
      author_name: authorName,
      author_email: authorEmail || null,
      body,
      published: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'review_id' })
    .select()
    .single();

  if (error) throw new Error(`Failed to create reply: ${error.message}`);
  return data as ReviewReply;
}

export async function deleteReply(reviewId: string): Promise<void> {
  const { error } = await supabase.from('review_replies').delete().eq('review_id', reviewId);
  if (error) throw new Error(`Failed to delete reply: ${error.message}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/services/review.service.ts
git commit -m "feat(reviews): add core review service with CRUD, moderation, replies"
```

---

## Task 7: Review Import Service

**Files:**
- Create: `apps/backend/src/services/review-import.service.ts`

- [ ] **Step 1: Create import service**

```typescript
import { supabase } from '../config/supabase.js';
import type { ReviewImportResult } from '../types/index.js';

interface LooxRow {
  id: string;
  status: string;
  rating: string;
  email: string;
  img: string;
  nickname: string;
  full_name: string;
  review: string;
  date: string;
  productId: string;
  handle: string;
  variant: string;
  verified_purchase: string;
  orderId: string;
  reply: string;
  replied_at: string;
  metaobject_handle: string;
  incentivized: string;
}

function parseLooxCsv(csvText: string): LooxRow[] {
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    if (char === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === '\n' && !inQuotes) {
      lines.push(current);
      current = '';
    } else if (char === '\r' && !inQuotes) {
      // skip CR
    } else {
      current += char;
    }
  }
  if (current.trim()) lines.push(current);

  if (lines.length < 2) return [];

  const headerLine = lines[0].replace(/^\uFEFF/, ''); // Strip BOM
  const headers = parseCSVLine(headerLine);

  const rows: LooxRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = parseCSVLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row as unknown as LooxRow);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

async function downloadAndStoreImage(imageUrl: string, reviewId: string, index: number): Promise<{ storagePath: string; publicUrl: string } | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const ext = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)/i)?.[1] || 'jpg';
    const path = `reviews/${reviewId}/${index}.${ext}`;

    const { error } = await supabase.storage
      .from('review-media')
      .upload(path, buffer, { contentType: `image/${ext}`, upsert: true });

    if (error) {
      console.error(`[review-import] Failed to upload ${imageUrl}:`, error.message);
      return null;
    }

    const { data: urlData } = supabase.storage.from('review-media').getPublicUrl(path);
    return { storagePath: path, publicUrl: urlData.publicUrl };
  } catch (err) {
    console.error(`[review-import] Download failed for ${imageUrl}:`, err instanceof Error ? err.message : String(err));
    return null;
  }
}

export async function importReviews(csvText: string, brandId: string): Promise<ReviewImportResult> {
  const rows = parseLooxCsv(csvText);
  console.log(`[review-import] Parsed ${rows.length} rows from CSV`);

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const errors: string[] = [];

  // Process in batches of 20
  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);

    for (const row of batch) {
      try {
        // Check for duplicate
        if (row.id) {
          const { data: existing } = await supabase
            .from('reviews')
            .select('id')
            .eq('import_source_id', row.id)
            .single();

          if (existing) {
            skipped++;
            continue;
          }
        }

        // Find product by handle
        const { data: product } = await supabase
          .from('products')
          .select('id, shopify_product_id')
          .eq('handle', row.handle)
          .eq('brand_id', brandId)
          .single();

        if (!product) {
          errors.push(`Row ${row.id}: Product "${row.handle}" not found`);
          failed++;
          continue;
        }

        const status = row.status === 'Active' ? 'published' : 'pending';
        const submittedAt = row.date || new Date().toISOString();

        // Generate nickname if not provided
        const nickname = row.nickname || (row.full_name
          ? row.full_name.split(' ')[0] + ' ' + (row.full_name.split(' ').pop()?.[0] || '') + '.'
          : 'Anonymous');

        const { data: review, error: insertError } = await supabase
          .from('reviews')
          .insert({
            product_id: product.id,
            shopify_product_id: product.shopify_product_id,
            shopify_order_id: row.orderId || null,
            customer_email: row.email || '',
            customer_name: row.full_name || nickname,
            customer_nickname: nickname,
            rating: parseInt(row.rating) || 5,
            body: row.review,
            status,
            verified_purchase: row.verified_purchase === 'true',
            incentivized: row.incentivized === 'true',
            variant_title: row.variant || null,
            source: 'import',
            import_source_id: row.id || null,
            published_at: status === 'published' ? submittedAt : null,
            submitted_at: submittedAt,
            brand_id: brandId,
          })
          .select()
          .single();

        if (insertError) {
          errors.push(`Row ${row.id}: ${insertError.message}`);
          failed++;
          continue;
        }

        // Download and store images
        if (row.img) {
          const imageUrls = row.img.split(',').map(u => u.trim()).filter(Boolean);
          for (let imgIdx = 0; imgIdx < imageUrls.length; imgIdx++) {
            const result = await downloadAndStoreImage(imageUrls[imgIdx], review.id, imgIdx);
            if (result) {
              await supabase.from('review_media').insert({
                review_id: review.id,
                storage_path: result.storagePath,
                url: result.publicUrl,
                media_type: 'image',
                sort_order: imgIdx,
              });
            }
          }
        }

        // Import reply if exists
        if (row.reply && row.reply.trim()) {
          await supabase.from('review_replies').insert({
            review_id: review.id,
            author_name: 'Store Owner',
            body: row.reply,
            published: true,
            created_at: row.replied_at || new Date().toISOString(),
          });
        }

        imported++;
      } catch (err) {
        errors.push(`Row ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      }
    }

    console.log(`[review-import] Progress: ${Math.min(i + 20, rows.length)}/${rows.length}`);
  }

  console.log(`[review-import] Complete: ${imported} imported, ${skipped} skipped, ${failed} failed`);
  return { imported, skipped, failed, errors };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/services/review-import.service.ts
git commit -m "feat(reviews): add CSV import service with Loox format support"
```

---

## Task 8: Review Email Service

**Files:**
- Create: `apps/backend/src/services/review-email.service.ts`
- Reference: `apps/backend/src/services/email.service.ts` (Resend pattern)

- [ ] **Step 1: Create review email service**

```typescript
import { supabase } from '../config/supabase.js';
import { config } from '../config/env.js';
import type { ReviewRequest, ReviewEmailTemplate } from '../types/index.js';
import { getSettings } from './review-settings.service.js';
import { Resend } from 'resend';

const resend = new Resend(config.email.resendApiKey);

async function getTemplate(brandId: string, type: string): Promise<ReviewEmailTemplate | null> {
  // Try brand-specific first, then fallback to defaults
  const { data } = await supabase
    .from('review_email_templates')
    .select()
    .eq('brand_id', brandId)
    .eq('template_type', type)
    .single();

  if (data) return data as ReviewEmailTemplate;

  // Fallback to default templates
  const { data: defaultTpl } = await supabase
    .from('review_email_templates')
    .select()
    .eq('brand_id', '00000000-0000-0000-0000-000000000000')
    .eq('template_type', type)
    .single();

  return defaultTpl ? (defaultTpl as ReviewEmailTemplate) : null;
}

function renderTemplate(html: string, vars: Record<string, string>): string {
  let rendered = html;
  for (const [key, value] of Object.entries(vars)) {
    rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return rendered;
}

export async function scheduleReviewRequest(
  order: {
    shopify_order_id: string;
    shopify_customer_id?: string;
    customer_email: string;
    customer_name?: string;
    product_ids: string[];
  },
  brandId: string,
): Promise<void> {
  const settings = await getSettings(brandId);
  if (!settings.request_enabled) return;
  if (!order.customer_email) return;

  // Check if request already exists for this order
  const { data: existing } = await supabase
    .from('review_requests')
    .select('id')
    .eq('shopify_order_id', order.shopify_order_id)
    .eq('brand_id', brandId)
    .single();

  if (existing) return;

  const scheduledFor = new Date();
  scheduledFor.setDate(scheduledFor.getDate() + settings.request_delay_days);

  const token = crypto.randomUUID();

  const { error } = await supabase.from('review_requests').insert({
    shopify_order_id: order.shopify_order_id,
    shopify_customer_id: order.shopify_customer_id || null,
    customer_email: order.customer_email,
    customer_name: order.customer_name || null,
    product_ids: order.product_ids,
    status: 'scheduled',
    scheduled_for: scheduledFor.toISOString(),
    token,
    brand_id: brandId,
  });

  if (error) console.error('[review-email] Schedule error:', error.message);
  else console.log(`[review-email] Scheduled request for order ${order.shopify_order_id}, send at ${scheduledFor.toISOString()}`);
}

export async function processScheduledEmails(): Promise<number> {
  const now = new Date().toISOString();
  const { data: requests, error } = await supabase
    .from('review_requests')
    .select()
    .eq('status', 'scheduled')
    .lte('scheduled_for', now)
    .limit(50);

  if (error || !requests?.length) return 0;

  let sent = 0;
  for (const req of requests as ReviewRequest[]) {
    try {
      const settings = await getSettings(req.brand_id);
      const template = await getTemplate(req.brand_id, 'request');
      if (!template || !template.enabled) continue;

      // Get product info for the email
      const productIds = req.product_ids;
      let productTitle = 'your purchase';
      if (productIds.length > 0) {
        const { data: product } = await supabase.from('products').select('title').eq('id', productIds[0]).single();
        if (product) productTitle = product.title;
      }

      const backendUrl = config.server.nodeEnv === 'production'
        ? `https://${config.server.corsOrigin?.split(',')[0]?.trim() || 'localhost:3001'}`
        : `http://localhost:${config.server.port}`;

      const reviewLink = `${backendUrl}/review?token=${req.token}`;

      const subject = renderTemplate(template.subject, {
        customer_name: req.customer_name || 'there',
        product_title: productTitle,
      });

      const bodyHtml = renderTemplate(template.body_html, {
        customer_name: req.customer_name || 'there',
        product_title: productTitle,
        review_link: reviewLink,
        brand_name: 'Outlight',
      });

      const fromEmail = settings.sender_email || config.email.fromAddress;
      const fromName = settings.sender_name || 'Outlight';

      await resend.emails.send({
        from: `${fromName} <${fromEmail}>`,
        to: req.customer_email,
        subject,
        html: bodyHtml,
      });

      // Update request
      const reminderDate = new Date();
      reminderDate.setDate(reminderDate.getDate() + (settings.reminder_delay_days || 7));

      await supabase.from('review_requests').update({
        status: 'sent',
        sent_at: now,
        reminder_scheduled_for: settings.reminder_enabled ? reminderDate.toISOString() : null,
      }).eq('id', req.id);

      sent++;
    } catch (err) {
      console.error(`[review-email] Failed to send to ${req.customer_email}:`, err instanceof Error ? err.message : String(err));
      await supabase.from('review_requests').update({ status: 'bounced' }).eq('id', req.id);
    }
  }

  if (sent > 0) console.log(`[review-email] Sent ${sent} review request emails`);
  return sent;
}

export async function processScheduledReminders(): Promise<number> {
  const now = new Date().toISOString();
  const { data: requests, error } = await supabase
    .from('review_requests')
    .select()
    .eq('status', 'sent')
    .not('reminder_scheduled_for', 'is', null)
    .lte('reminder_scheduled_for', now)
    .limit(50);

  if (error || !requests?.length) return 0;

  let sent = 0;
  for (const req of requests as ReviewRequest[]) {
    try {
      const settings = await getSettings(req.brand_id);
      const template = await getTemplate(req.brand_id, 'reminder');
      if (!template || !template.enabled) continue;

      let productTitle = 'your purchase';
      if (req.product_ids.length > 0) {
        const { data: product } = await supabase.from('products').select('title').eq('id', req.product_ids[0]).single();
        if (product) productTitle = product.title;
      }

      const backendUrl = config.server.nodeEnv === 'production'
        ? `https://${config.server.corsOrigin?.split(',')[0]?.trim() || 'localhost:3001'}`
        : `http://localhost:${config.server.port}`;

      const reviewLink = `${backendUrl}/review?token=${req.token}`;

      const subject = renderTemplate(template.subject, {
        customer_name: req.customer_name || 'there',
        product_title: productTitle,
      });

      const bodyHtml = renderTemplate(template.body_html, {
        customer_name: req.customer_name || 'there',
        product_title: productTitle,
        review_link: reviewLink,
        brand_name: 'Outlight',
      });

      const fromEmail = settings.sender_email || config.email.fromAddress;
      const fromName = settings.sender_name || 'Outlight';

      await resend.emails.send({
        from: `${fromName} <${fromEmail}>`,
        to: req.customer_email,
        subject,
        html: bodyHtml,
      });

      await supabase.from('review_requests').update({
        status: 'reminded',
        reminder_sent_at: now,
      }).eq('id', req.id);

      sent++;
    } catch (err) {
      console.error(`[review-email] Reminder failed for ${req.customer_email}:`, err instanceof Error ? err.message : String(err));
    }
  }

  if (sent > 0) console.log(`[review-email] Sent ${sent} reminder emails`);
  return sent;
}

export async function expireOldRequests(): Promise<number> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data, error } = await supabase
    .from('review_requests')
    .update({ status: 'expired' })
    .in('status', ['sent', 'reminded'])
    .lt('created_at', thirtyDaysAgo.toISOString())
    .select('id');

  if (error) console.error('[review-email] Expire error:', error.message);
  return data?.length ?? 0;
}

// Email templates CRUD
export async function getEmailTemplates(brandId: string): Promise<ReviewEmailTemplate[]> {
  const { data } = await supabase
    .from('review_email_templates')
    .select()
    .eq('brand_id', brandId)
    .order('template_type');

  if (!data || data.length === 0) {
    // Return defaults
    const { data: defaults } = await supabase
      .from('review_email_templates')
      .select()
      .eq('brand_id', '00000000-0000-0000-0000-000000000000')
      .order('template_type');

    return (defaults ?? []) as ReviewEmailTemplate[];
  }

  return data as ReviewEmailTemplate[];
}

export async function updateEmailTemplate(
  brandId: string,
  templateType: string,
  updates: { subject?: string; body_html?: string; enabled?: boolean },
): Promise<ReviewEmailTemplate> {
  const { data, error } = await supabase
    .from('review_email_templates')
    .upsert({
      brand_id: brandId,
      template_type: templateType,
      ...updates,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'brand_id,template_type' })
    .select()
    .single();

  if (error) throw new Error(`Failed to update template: ${error.message}`);
  return data as ReviewEmailTemplate;
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/services/review-email.service.ts
git commit -m "feat(reviews): add review email collection service with templates"
```

---

## Task 9: Review Analytics Service

**Files:**
- Create: `apps/backend/src/services/review-analytics.service.ts`

- [ ] **Step 1: Create analytics service**

```typescript
import { supabase } from '../config/supabase.js';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config/env.js';

const anthropic = new Anthropic({ apiKey: config.ai.apiKey });
const CACHE_TTL_HOURS = 24;

interface ThemeResult {
  name: string;
  sentiment: number;
  mention_count: number;
  representative_quotes: string[];
}

interface TrendResult {
  period: string;
  average_rating: number;
  review_count: number;
  sentiment_change: number;
}

interface ActionItem {
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  evidence: string;
  review_count: number;
}

interface AnalysisSummary {
  overall_sentiment: number;
  themes: ThemeResult[];
  trends: TrendResult[];
  actions: ActionItem[];
  summary: string;
}

async function getCachedAnalysis(brandId: string, productId: string | null, type: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from('review_analytics_cache')
    .select()
    .eq('brand_id', brandId)
    .eq('analysis_type', type)
    .gt('expires_at', new Date().toISOString());

  if (!data || data.length === 0) return null;

  // Filter by product_id (null for store-wide)
  const match = data.find(d => productId ? d.product_id === productId : !d.product_id);
  return match?.data || null;
}

async function cacheAnalysis(brandId: string, productId: string | null, type: string, analysisData: Record<string, unknown>, reviewCount: number): Promise<void> {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + CACHE_TTL_HOURS);

  // Delete old cache
  let deleteQuery = supabase
    .from('review_analytics_cache')
    .delete()
    .eq('brand_id', brandId)
    .eq('analysis_type', type);

  if (productId) deleteQuery = deleteQuery.eq('product_id', productId);
  else deleteQuery = deleteQuery.is('product_id', null);

  await deleteQuery;

  await supabase.from('review_analytics_cache').insert({
    brand_id: brandId,
    product_id: productId,
    analysis_type: type,
    data: analysisData,
    review_count: reviewCount,
    analyzed_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
  });
}

export async function analyzeReviews(brandId: string, productId?: string): Promise<AnalysisSummary> {
  // Check cache first
  const cached = await getCachedAnalysis(brandId, productId || null, 'summary');
  if (cached) return cached as unknown as AnalysisSummary;

  // Fetch reviews
  let query = supabase
    .from('reviews')
    .select('rating, body, title, variant_title, verified_purchase, created_at')
    .eq('brand_id', brandId)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(500);

  if (productId) query = query.eq('product_id', productId);

  const { data: reviews } = await query;
  if (!reviews || reviews.length === 0) {
    return { overall_sentiment: 0, themes: [], trends: [], actions: [], summary: 'No reviews to analyze.' };
  }

  // Prepare review text for Claude
  const reviewTexts = reviews.map((r, i) =>
    `[${i + 1}] Rating: ${r.rating}/5 | Date: ${r.created_at?.substring(0, 10)} | Variant: ${r.variant_title || 'N/A'} | Verified: ${r.verified_purchase}\nTitle: ${r.title || 'N/A'}\nReview: ${r.body}`
  ).join('\n\n');

  const response = await anthropic.messages.create({
    model: config.ai.model,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `Analyze these ${reviews.length} product reviews and provide structured insights.

REVIEWS:
${reviewTexts}

Respond with a JSON object (no markdown, just raw JSON) with this exact structure:
{
  "overall_sentiment": <number 1-5>,
  "summary": "<2-3 sentence overview of what customers think>",
  "themes": [
    {
      "name": "<topic name>",
      "sentiment": <number 1-5>,
      "mention_count": <int>,
      "representative_quotes": ["<quote1>", "<quote2>"]
    }
  ],
  "trends": [
    {
      "period": "<month/year>",
      "average_rating": <number>,
      "review_count": <int>,
      "sentiment_change": <number, positive or negative>
    }
  ],
  "actions": [
    {
      "priority": "high|medium|low",
      "title": "<short action title>",
      "description": "<what to do and why>",
      "evidence": "<supporting data from reviews>",
      "review_count": <how many reviews support this>
    }
  ]
}

Focus on actionable insights. Identify recurring themes, sentiment patterns, and specific improvements the business could make. Be specific with evidence from actual reviews.`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  let analysis: AnalysisSummary;
  try {
    analysis = JSON.parse(text);
  } catch {
    console.error('[review-analytics] Failed to parse Claude response');
    analysis = { overall_sentiment: 0, themes: [], trends: [], actions: [], summary: 'Analysis failed to parse.' };
  }

  // Cache the results
  await cacheAnalysis(brandId, productId || null, 'summary', analysis as unknown as Record<string, unknown>, reviews.length);

  return analysis;
}

export async function suggestReplyDraft(reviewBody: string, reviewRating: number, customerName: string): Promise<string> {
  const response = await anthropic.messages.create({
    model: config.ai.model,
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Write a short, professional, warm reply to this customer review. Keep it under 3 sentences. Be genuine, not corporate.

Customer: ${customerName}
Rating: ${reviewRating}/5
Review: "${reviewBody}"

Reply as the store owner. Start with their name. If positive, thank them warmly. If negative, acknowledge their concern and offer to help.`,
    }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

export async function getAnalyticsStats(brandId: string): Promise<Record<string, unknown>> {
  const [
    totalRes,
    publishedRes,
    pendingRes,
    avgRes,
    thisMonthRes,
    lastMonthRes,
    requestsSentRes,
    requestsCompletedRes,
  ] = await Promise.all([
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('brand_id', brandId),
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'published'),
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'pending'),
    supabase.from('reviews').select('rating').eq('brand_id', brandId).eq('status', 'published'),
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    supabase.from('reviews').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString()).lt('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    supabase.from('review_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).in('status', ['sent', 'reminded', 'completed']),
    supabase.from('review_requests').select('id', { count: 'exact', head: true }).eq('brand_id', brandId).eq('status', 'completed'),
  ]);

  const ratings = avgRes.data ?? [];
  const avgRating = ratings.length > 0
    ? Math.round((ratings.reduce((s: number, r: { rating: number }) => s + r.rating, 0) / ratings.length) * 10) / 10
    : 0;

  const collectionRate = (requestsSentRes.count ?? 0) > 0
    ? Math.round(((requestsCompletedRes.count ?? 0) / (requestsSentRes.count ?? 0)) * 100)
    : 0;

  // Count reviews with replies
  const { count: repliedCount } = await supabase
    .from('review_replies')
    .select('id', { count: 'exact', head: true });

  const responseRate = (publishedRes.count ?? 0) > 0
    ? Math.round(((repliedCount ?? 0) / (publishedRes.count ?? 0)) * 100)
    : 0;

  return {
    total: totalRes.count ?? 0,
    published: publishedRes.count ?? 0,
    pending: pendingRes.count ?? 0,
    average_rating: avgRating,
    this_month: thisMonthRes.count ?? 0,
    last_month: lastMonthRes.count ?? 0,
    collection_rate: collectionRate,
    response_rate: responseRate,
    with_photos: 0, // We'll compute this separately if needed
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/services/review-analytics.service.ts
git commit -m "feat(reviews): add AI-powered review analytics service"
```

---

## Task 10: Review Controller (Public API)

**Files:**
- Create: `apps/backend/src/controllers/review.controller.ts`
- Modify: `apps/backend/src/index.ts` (register routes + webhooks + email job)

- [ ] **Step 1: Create review controller**

```typescript
import { Router } from 'express';
import type { Request, Response } from 'express';
import { supabase } from '../config/supabase.js';
import { resolveBrandId } from '../config/brand.js';
import * as reviewService from '../services/review.service.js';
import * as reviewSettings from '../services/review-settings.service.js';
import * as productSync from '../services/product-sync.service.js';
import * as reviewImport from '../services/review-import.service.js';
import * as reviewEmail from '../services/review-email.service.js';
import * as reviewAnalytics from '../services/review-analytics.service.js';
import crypto from 'crypto';
import { config } from '../config/env.js';

export const reviewRouter = Router();

// Rate limiting map for helpful/report
const actionCooldowns = new Map<string, number>();

function isRateLimited(key: string, cooldownMs: number = 60000): boolean {
  const last = actionCooldowns.get(key);
  if (last && Date.now() - last < cooldownMs) return true;
  actionCooldowns.set(key, Date.now());
  return false;
}

// ── Public endpoints ──

// GET /api/reviews/product/:handle — Published reviews for widget
reviewRouter.get('/product/:handle', async (req: Request, res: Response) => {
  try {
    const brandId = await resolveBrandId(req);
    const { page, per_page, sort } = req.query;
    const result = await reviewService.getReviewsByProduct(req.params.handle, brandId, {
      page: page ? parseInt(page as string, 10) : 1,
      perPage: per_page ? parseInt(per_page as string, 10) : 10,
      sort: sort as string || 'newest',
      status: 'published',
    });

    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review] Get reviews error:', message);
    res.status(500).json({ error: 'Failed to load reviews' });
  }
});

// GET /api/reviews/product/:handle/summary — Rating summary
reviewRouter.get('/product/:handle/summary', async (req: Request, res: Response) => {
  try {
    const brandId = await resolveBrandId(req);
    const summary = await reviewService.getReviewSummary(req.params.handle, brandId);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review] Get summary error:', message);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// POST /api/reviews/submit — Submit a review
reviewRouter.post('/submit', async (req: Request, res: Response) => {
  try {
    const brandId = await resolveBrandId(req);
    const { product_handle, customer_email, customer_name, rating, title, body, variant_title, token } = req.body;

    if (!product_handle || !customer_email || !customer_name || !rating || !body) {
      res.status(400).json({ error: 'product_handle, customer_email, customer_name, rating, and body are required' });
      return;
    }

    if (rating < 1 || rating > 5) {
      res.status(400).json({ error: 'Rating must be between 1 and 5' });
      return;
    }

    const review = await reviewService.submitReview({
      product_handle,
      customer_email,
      customer_name,
      rating: parseInt(rating),
      title,
      body,
      variant_title,
      token,
      brand_id: brandId,
    });

    res.status(201).json({ review });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review] Submit error:', message);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// POST /api/reviews/upload — Upload review media
reviewRouter.post('/upload', async (req: Request, res: Response) => {
  try {
    // Accept base64-encoded file
    const { file, filename, review_id } = req.body;
    if (!file || !filename) {
      res.status(400).json({ error: 'file and filename are required' });
      return;
    }

    const buffer = Buffer.from(file, 'base64');
    const ext = filename.split('.').pop() || 'jpg';
    const path = `reviews/${review_id || 'temp'}/${crypto.randomUUID()}.${ext}`;

    const { error } = await supabase.storage
      .from('review-media')
      .upload(path, buffer, { contentType: `image/${ext}`, upsert: true });

    if (error) throw new Error(error.message);

    const { data: urlData } = supabase.storage.from('review-media').getPublicUrl(path);

    res.status(201).json({
      storage_path: path,
      url: urlData.publicUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[review] Upload error:', message);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// POST /api/reviews/helpful/:id — Mark helpful
reviewRouter.post('/helpful/:id', async (req: Request, res: Response) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `helpful:${req.params.id}:${ip}`;
    if (isRateLimited(key, 3600000)) {
      res.status(429).json({ error: 'Already marked as helpful' });
      return;
    }
    await reviewService.markHelpful(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to mark helpful' });
  }
});

// POST /api/reviews/report/:id — Report review
reviewRouter.post('/report/:id', async (req: Request, res: Response) => {
  try {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const key = `report:${req.params.id}:${ip}`;
    if (isRateLimited(key, 86400000)) {
      res.status(429).json({ error: 'Already reported' });
      return;
    }
    await reviewService.reportReview(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to report review' });
  }
});

// GET /api/reviews/widget/config — Widget design config
reviewRouter.get('/widget/config', async (req: Request, res: Response) => {
  try {
    const brandId = await resolveBrandId(req);
    const design = await reviewSettings.getWidgetDesign(brandId);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ design });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// ── Shopify Webhooks ──

function verifyShopifyWebhook(req: Request): boolean {
  const hmac = req.headers['x-shopify-hmac-sha256'] as string;
  if (!hmac || !config.shopify.clientSecret) return false;
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  if (!rawBody) return true; // Skip verification in dev if rawBody not available
  const hash = crypto.createHmac('sha256', config.shopify.clientSecret).update(rawBody).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmac));
}

// Product webhooks
reviewRouter.post('/webhooks/shopify/products', async (req: Request, res: Response) => {
  try {
    const topic = req.headers['x-shopify-topic'] as string;
    if (!topic) { res.status(400).json({ error: 'Missing topic' }); return; }

    // Verify HMAC in production
    if (config.server.nodeEnv === 'production' && !verifyShopifyWebhook(req)) {
      res.status(401).json({ error: 'Invalid HMAC' });
      return;
    }

    const brandId = await resolveBrandId(req);
    await productSync.handleProductWebhook(topic, req.body, brandId);
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[review] Product webhook error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Order fulfilled webhook → schedule review request
reviewRouter.post('/webhooks/shopify/orders', async (req: Request, res: Response) => {
  try {
    const topic = req.headers['x-shopify-topic'] as string;
    if (topic !== 'orders/fulfilled') { res.status(200).json({ ok: true }); return; }

    if (config.server.nodeEnv === 'production' && !verifyShopifyWebhook(req)) {
      res.status(401).json({ error: 'Invalid HMAC' });
      return;
    }

    const brandId = await resolveBrandId(req);
    const order = req.body;

    // Get product IDs from line items
    const lineItemProductIds = (order.line_items || []).map((li: { product_id: number }) => String(li.product_id));

    // Look up our product UUIDs
    const { data: products } = await supabase
      .from('products')
      .select('id')
      .in('shopify_product_id', lineItemProductIds)
      .eq('brand_id', brandId);

    const productIds = (products ?? []).map(p => p.id);

    if (productIds.length > 0 && order.email) {
      await reviewEmail.scheduleReviewRequest({
        shopify_order_id: String(order.id),
        shopify_customer_id: order.customer?.id ? String(order.customer.id) : undefined,
        customer_email: order.email,
        customer_name: order.customer?.first_name || undefined,
        product_ids: productIds,
      }, brandId);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[review] Order webhook error:', err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
```

- [ ] **Step 2: Register routes and email job in index.ts**

Add to `apps/backend/src/index.ts`:

After the existing router imports, add:
```typescript
import { reviewRouter } from './controllers/review.controller.js';
import { processScheduledEmails, processScheduledReminders, expireOldRequests } from './services/review-email.service.js';
```

After existing route registrations, add:
```typescript
app.use('/api/reviews', reviewRouter);
```

In the server startup section (after `app.listen`), add the email job runner:
```typescript
// Review email job runner (every 5 minutes)
setInterval(async () => {
  try {
    await processScheduledEmails();
    await processScheduledReminders();
    await expireOldRequests();
  } catch (err) {
    console.error('[review-email-job] Error:', err instanceof Error ? err.message : String(err));
  }
}, 5 * 60 * 1000);
console.log('[server] Review email job runner started (5m interval)');
```

Also add a review submission page endpoint (simple HTML form for email links):
```typescript
app.get('/review', (req, res) => {
  const token = req.query.token as string;
  if (!token) { res.status(400).send('Missing token'); return; }
  // Serve the review submission page
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Write a Review</title></head><body>
<div id="review-form-root" data-token="${token}"></div>
<script src="/widget/review-widget.js"></script>
</body></html>`);
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/backend/src/controllers/review.controller.ts apps/backend/src/index.ts
git commit -m "feat(reviews): add review controller with public API, webhooks, email job"
```

---

## Task 11: Review Widget (Storefront)

**Files:**
- Create: `apps/widget/src/review-widget.ts`
- Create: `apps/widget/src/styles/review-widget.css`
- Create: `apps/widget/vite.review-widget.config.ts`
- Modify: `apps/widget/package.json` (add build command)

- [ ] **Step 1: Create review widget CSS**

Create `apps/widget/src/styles/review-widget.css` with the complete styles matching the reference design. Class prefix: `orw-` (Outlight Review Widget). Gold stars (#C4A265), clean cards, responsive grid→stack layout. Include styles for: header section, review cards, star ratings, verified badges, photo thumbnails, lightbox, review form modal, load-more button, owner replies.

- [ ] **Step 2: Create review widget TypeScript**

Create `apps/widget/src/review-widget.ts` — the main entry point. Self-executing IIFE that:
1. Detects `data-product-handle` from the container element `#outlight-reviews`
2. Detects `data-token` from `#review-form-root` (for email submission page)
3. Extracts backend URL from script src
4. Fetches widget config (design settings) from `/api/reviews/widget/config`
5. Fetches review summary from `/api/reviews/product/:handle/summary`
6. Fetches reviews from `/api/reviews/product/:handle`
7. Renders: header (title, stars, count, write-review button), review cards grid, load-more pagination
8. "Write a Review" button opens modal form with: star picker, title, body, photo upload, name, email, variant
9. Submits via POST `/api/reviews/submit`
10. Photo upload via POST `/api/reviews/upload`
11. Supports live design updates via `postMessage` (for playground)
12. Responsive: 2-column grid on desktop (>768px), single column on mobile
13. CSS injected as `<style>` tag (same pattern as returns-portal)

Key rendering functions:
- `renderHeader(summary, design)` — "CUSTOMER REVIEWS" + stars + rating + count + button
- `renderReviewCard(review, design)` — name + verified badge + date + stars + body + photos + variant + reply
- `renderStars(rating, color)` — SVG star icons
- `renderReviewForm(handle, design, token?)` — modal with form
- `renderLightbox(images, startIndex)` — photo viewer modal

- [ ] **Step 3: Create Vite config for review widget**

Create `apps/widget/vite.review-widget.config.ts`:

```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/review-widget.ts'),
      name: 'OutlightReviewWidget',
      formats: ['iife'],
      fileName: () => 'review-widget.js',
    },
    outDir: 'dist',
    emptyDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
    minify: 'esbuild',
  },
});
```

- [ ] **Step 4: Update widget package.json build script**

Add to the build script in `apps/widget/package.json`:
```
"build": "... && vite build --config vite.review-widget.config.ts"
```

- [ ] **Step 5: Commit**

```bash
git add apps/widget/src/review-widget.ts apps/widget/src/styles/review-widget.css apps/widget/vite.review-widget.config.ts apps/widget/package.json
git commit -m "feat(reviews): add storefront review widget with form and design system"
```

---

## Task 12: Admin API Routes

**Files:**
- Create: `apps/admin/src/app/api/reviews/route.ts`
- Create: `apps/admin/src/app/api/reviews/[id]/route.ts`
- Create: `apps/admin/src/app/api/reviews/[id]/reply/route.ts`
- Create: `apps/admin/src/app/api/reviews/bulk/route.ts`
- Create: `apps/admin/src/app/api/reviews/import/route.ts`
- Create: `apps/admin/src/app/api/reviews/products/route.ts`
- Create: `apps/admin/src/app/api/reviews/products/sync/route.ts`
- Create: `apps/admin/src/app/api/reviews/settings/route.ts`
- Create: `apps/admin/src/app/api/reviews/design/route.ts`
- Create: `apps/admin/src/app/api/reviews/emails/route.ts`
- Create: `apps/admin/src/app/api/reviews/emails/[type]/route.ts`
- Create: `apps/admin/src/app/api/reviews/analytics/route.ts`
- Create: `apps/admin/src/app/api/reviews/analytics/refresh/route.ts`
- Create: `apps/admin/src/app/api/reviews/stats/route.ts`
- Create: `apps/admin/src/app/api/reviews/upload/route.ts`

All follow the exact pattern from returns API routes: `getSession()` auth check, `session.brandId` scoping, Supabase queries, standard error handling.

- [ ] **Step 1: Create reviews list + bulk route (`route.ts`)**

GET: list reviews with pagination, filtering (status, product, rating, search, date range, source, has_media). Joins media count and product title.
POST (bulk): accept `{ ids: string[], action: 'publish'|'reject'|'archive'|'delete' }`.

- [ ] **Step 2: Create single review route (`[id]/route.ts`)**

GET: full review with media, reply, product info.
PATCH: update review fields.
DELETE: delete review.

- [ ] **Step 3: Create reply route (`[id]/reply/route.ts`)**

POST: create/update reply. Body: `{ author_name, body }`.
DELETE: delete reply.

- [ ] **Step 4: Create import route**

POST: accept CSV text in body. Call `importReviews()` from import service. Return result.

- [ ] **Step 5: Create products routes**

GET `/products`: list synced products with review stats (count, avg rating per product).
POST `/products/sync`: trigger `fullSync()` from product-sync service.

- [ ] **Step 6: Create settings + design routes**

GET/PUT `/settings`: same upsert pattern as return settings.
GET/PUT `/design`: read/write `widget_design` from review_settings.

- [ ] **Step 7: Create email template routes**

GET `/emails`: list templates. GET/PUT `/emails/[type]`: read/update template.

- [ ] **Step 8: Create analytics routes**

GET `/analytics`: return cached or fresh analysis. POST `/analytics/refresh`: force re-analysis.

- [ ] **Step 9: Create stats route**

GET `/stats`: return counts by status (all, published, pending, rejected) using parallel queries.

- [ ] **Step 10: Create upload route**

POST `/upload`: proxy file upload to Supabase Storage. Accept multipart form data.

- [ ] **Step 11: Commit**

```bash
git add apps/admin/src/app/api/reviews/
git commit -m "feat(reviews): add admin API routes for reviews management"
```

---

## Task 13: Admin Dashboard Pages

**Files:**
- Create: `apps/admin/src/app/(dashboard)/reviews/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/reviews/products/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/reviews/playground/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/reviews/emails/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/reviews/emails/[type]/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/reviews/design/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/reviews/analytics/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/reviews/import/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/reviews/settings/page.tsx`
- Modify: `apps/admin/src/components/sidebar.tsx` (add Reviews nav group)

- [ ] **Step 1: Update sidebar**

Add Reviews nav group after Returns in `sidebar.tsx`:

```typescript
{
  label: 'Reviews',
  collapsible: true,
  defaultCollapsed: false,
  items: [
    { href: '/reviews', label: 'All Reviews', icon: Star },
    { href: '/reviews/products', label: 'Products', icon: Package },
    { href: '/reviews/playground', label: 'Playground', icon: TestTube },
    { href: '/reviews/emails', label: 'Email Templates', icon: Mail },
    { href: '/reviews/design', label: 'Widget Design', icon: Palette },
    { href: '/reviews/analytics', label: 'Analytics', icon: BarChart3 },
    { href: '/reviews/import', label: 'Import', icon: Upload },
    { href: '/reviews/settings', label: 'Settings', icon: Settings },
  ],
},
```

Import `Star` and `Upload` from lucide-react.

- [ ] **Step 2: Create All Reviews page**

`/reviews/page.tsx` — Follow the Returns list page pattern exactly:
- Data table with sidebar filters (All, Published, Pending, Rejected)
- Columns: reviewer name, product, rating (gold stars), status badge, verified badge, source, date
- Search by customer name/email/review text
- Click row → slide-out detail panel or inline expansion showing full review, media, reply editor
- Bulk action toolbar (publish, reject, archive, delete)
- Pagination

- [ ] **Step 3: Create Products page**

`/reviews/products/page.tsx` — Table of synced products:
- Columns: product image, title, handle, review count, avg rating (stars), Shopify status
- "Sync Now" button at top → calls POST `/api/reviews/products/sync`
- Click row → navigate to `/reviews?product=<id>` (filtered reviews)

- [ ] **Step 4: Create Playground page**

`/reviews/playground/page.tsx` — Follow returns playground pattern:
- Left: iframe showing review widget preview
- Right: debug panel with events
- Reset button to reload iframe

- [ ] **Step 5: Create Email Templates pages**

`/reviews/emails/page.tsx` — List of template types (request, reminder, thank_you) with toggle and edit link.
`/reviews/emails/[type]/page.tsx` — Template editor with subject, HTML body textarea, variable reference, preview pane.

- [ ] **Step 6: Create Design page**

`/reviews/design/page.tsx` — Follow returns design page pattern:
- Left panel: design controls (star color picker, text color, fonts, border radius, card style, button style, header text, layout toggle)
- Right panel: live iframe preview with postMessage updates
- Color presets, save/reset buttons

- [ ] **Step 7: Create Analytics page**

`/reviews/analytics/page.tsx`:
- Top stat cards: total reviews, avg rating, collection rate, response rate
- Rating distribution bar chart (horizontal bars)
- Reviews over time line chart
- AI themes section: cards showing theme name, sentiment bar, mention count, quotes
- Action items section: priority-colored cards with title, description, evidence
- "Refresh Analysis" button

Uses Recharts for charts (already a dependency).

- [ ] **Step 8: Create Import page**

`/reviews/import/page.tsx`:
- File upload dropzone (drag & drop CSV)
- Format selector dropdown (default: Loox)
- Preview table showing first 5 parsed rows with field mapping
- Import button with progress indicator
- Results summary after completion

- [ ] **Step 9: Create Settings page**

`/reviews/settings/page.tsx` — Follow returns settings pattern with collapsible sections:
- Collection Settings: enable toggle, delay days input, reminder toggle + delay
- Moderation: auto-publish toggle, min rating select, verified-only toggle, profanity filter toggle
- Display: reviews per page, default sort select, verified badge toggle, incentivized disclosure toggle
- FTC Compliance: disclosure text input, verified badge text
- Email Sender: from name, from email
- Save button with unsaved changes detection

- [ ] **Step 10: Commit**

```bash
git add apps/admin/src/app/(dashboard)/reviews/ apps/admin/src/components/sidebar.tsx
git commit -m "feat(reviews): add admin dashboard pages for reviews management"
```

---

## Task 14: Backend Widget Serving & Playground

**Files:**
- Modify: `apps/backend/src/index.ts` (add review widget static serving + playground page)

- [ ] **Step 1: Add review widget static file serving**

In `index.ts`, add static serving for the review widget (same pattern as existing widget files):

```typescript
// After existing widget static serving
app.get('/widget/review-widget.js', (req, res) => {
  // Serve from widget dist
  res.sendFile(path.join(widgetDir, 'review-widget.js'));
});
```

Add playground preview endpoint:

```typescript
app.get('/widget/preview-reviews', (req, res) => {
  const brand = req.query.brand as string || '';
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review Widget Preview</title>
<style>body{margin:0;padding:20px;font-family:system-ui,sans-serif;background:#fff;}</style>
</head><body>
<div id="outlight-reviews" data-product-handle="aven"></div>
<script src="/widget/review-widget.js"${brand ? ` data-brand="${brand}"` : ''}></script>
</body></html>`);
});
```

- [ ] **Step 2: Commit**

```bash
git add apps/backend/src/index.ts
git commit -m "feat(reviews): add widget serving and playground preview endpoint"
```

---

## Task 15: Build & Integration Test

- [ ] **Step 1: Build the widget**

```bash
cd apps/widget && npm run build
```

Verify `dist/review-widget.js` exists.

- [ ] **Step 2: Build the admin**

```bash
cd apps/admin && npm run build
```

Fix any TypeScript errors.

- [ ] **Step 3: Build the backend**

```bash
cd apps/backend && npx tsc --noEmit
```

Fix any TypeScript errors.

- [ ] **Step 4: Start the backend and verify endpoints**

```bash
cd apps/backend && npm run dev
```

Test:
- `GET /api/reviews/product/aven/summary` → should return empty summary
- `GET /api/reviews/widget/config` → should return default design
- `GET /widget/preview-reviews` → should render preview page

- [ ] **Step 5: Run product sync**

Trigger a full product sync to populate the `products` table, then import the Loox CSV to populate reviews.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(reviews): complete reviews system - widget, admin, email, analytics"
```
