# Reviews System — Design Spec

## Overview

A complete, store-wide product reviews system integrated with Shopify. Covers review collection (post-purchase email automation), management (moderation, replies), storefront display (embeddable widget), AI-powered analytics, and CSV import from Loox.

Follows the existing Returns section architecture: backend services, admin dashboard pages, embeddable widget, Supabase storage.

## Constraints

- US-only sales → FTC compliance (no GDPR)
- Media storage: Supabase Storage (existing pattern from returns)
- Single widget type for now: product page reviews section (extensible for star badges, carousels, all-reviews page later)
- Multi-tenant via `brand_id` on all tables
- Shopify product sync via webhooks + initial full sync
- Email sending via Resend (existing service)

---

## Database Schema

### `products`

Synced from Shopify. Source of truth for product catalog within the reviews system.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| shopify_product_id | text | unique, not null |
| title | text | not null |
| handle | text | not null |
| product_type | text | nullable |
| vendor | text | nullable |
| status | text | default 'active' |
| featured_image_url | text | nullable |
| variants | jsonb | default '[]' |
| tags | text[] | default '{}' |
| synced_at | timestamptz | default now() |
| brand_id | uuid | not null |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Indexes: `(brand_id, handle)`, `(shopify_product_id)` unique

### `reviews`

Core review data. One row per customer review.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| product_id | uuid | FK → products.id |
| shopify_product_id | text | denormalized for widget queries |
| shopify_order_id | text | nullable |
| customer_email | text | not null |
| customer_name | text | not null |
| customer_nickname | text | nullable |
| rating | integer | not null, check 1-5 |
| title | text | nullable |
| body | text | not null |
| status | text | default 'pending', check in ('pending','published','rejected','archived') |
| verified_purchase | boolean | default false |
| incentivized | boolean | default false |
| variant_title | text | nullable |
| source | text | default 'organic', check in ('import','email_request','organic','manual') |
| import_source_id | text | nullable, unique when not null |
| featured | boolean | default false |
| helpful_count | integer | default 0 |
| report_count | integer | default 0 |
| published_at | timestamptz | nullable |
| submitted_at | timestamptz | default now() |
| brand_id | uuid | not null |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Indexes: `(product_id, status, created_at DESC)`, `(brand_id, status)`, `(customer_email)`, `(shopify_order_id)`, `(import_source_id)` unique partial

### `review_media`

Photos/videos attached to reviews. Stored in Supabase Storage.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| review_id | uuid | FK → reviews.id ON DELETE CASCADE |
| storage_path | text | not null |
| url | text | not null |
| media_type | text | default 'image', check in ('image','video') |
| sort_order | integer | default 0 |
| file_size | integer | nullable |
| width | integer | nullable |
| height | integer | nullable |
| created_at | timestamptz | default now() |

Index: `(review_id, sort_order)`

### `review_replies`

Owner replies to reviews. One reply per review.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| review_id | uuid | FK → reviews.id ON DELETE CASCADE, unique |
| author_name | text | not null |
| author_email | text | nullable |
| body | text | not null |
| published | boolean | default true |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### `review_requests`

Tracks email collection lifecycle per order.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| shopify_order_id | text | not null |
| shopify_customer_id | text | nullable |
| customer_email | text | not null |
| customer_name | text | nullable |
| product_ids | jsonb | not null, array of product UUIDs |
| status | text | default 'scheduled', check in ('scheduled','sent','reminded','completed','cancelled','bounced','expired') |
| scheduled_for | timestamptz | not null |
| sent_at | timestamptz | nullable |
| reminder_scheduled_for | timestamptz | nullable |
| reminder_sent_at | timestamptz | nullable |
| completed_at | timestamptz | nullable |
| token | text | unique, not null |
| brand_id | uuid | not null |
| created_at | timestamptz | default now() |

Indexes: `(status, scheduled_for)`, `(token)` unique, `(shopify_order_id)`

### `review_settings`

Per-brand configuration for the reviews system.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| brand_id | uuid | unique, not null |
| auto_publish | boolean | default true |
| auto_publish_min_rating | integer | default 1 |
| auto_publish_verified_only | boolean | default false |
| profanity_filter | boolean | default true |
| request_enabled | boolean | default true |
| request_delay_days | integer | default 14 |
| reminder_enabled | boolean | default true |
| reminder_delay_days | integer | default 7 |
| incentive_enabled | boolean | default false |
| incentive_type | text | nullable |
| incentive_value | text | nullable |
| sender_name | text | nullable |
| sender_email | text | nullable |
| review_form_fields | jsonb | default '{}' |
| widget_design | jsonb | default '{}' |
| reviews_per_page | integer | default 10 |
| default_sort | text | default 'newest' |
| show_verified_badge | boolean | default true |
| show_incentivized_disclosure | boolean | default true |
| incentivized_disclosure_text | text | default 'This reviewer received an incentive for their honest review.' |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### `review_analytics_cache`

Cached AI analysis results.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| brand_id | uuid | not null |
| product_id | uuid | nullable (null = store-wide) |
| analysis_type | text | not null, check in ('sentiment','themes','trends','actions','summary') |
| data | jsonb | not null |
| review_count | integer | not null |
| analyzed_at | timestamptz | default now() |
| expires_at | timestamptz | not null |

Index: `(brand_id, product_id, analysis_type)`

### `review_email_templates`

Customizable email templates for review collection.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| brand_id | uuid | not null |
| template_type | text | not null, check in ('request','reminder','thank_you') |
| subject | text | not null |
| body_html | text | not null |
| enabled | boolean | default true |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Index: `(brand_id, template_type)` unique

---

## Backend Services

### `review.controller.ts` — Public API

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/reviews/product/:handle` | GET | Public | Published reviews for product (paginated) |
| `/api/reviews/product/:handle/summary` | GET | Public | Rating avg, count, distribution |
| `/api/reviews/submit` | POST | Token | Submit review via email link or widget |
| `/api/reviews/upload` | POST | Public | Upload media to Supabase Storage |
| `/api/reviews/helpful/:id` | POST | Public | Increment helpful count (rate-limited) |
| `/api/reviews/report/:id` | POST | Public | Report review (rate-limited) |
| `/api/reviews/widget/config` | GET | Public | Widget design settings |

### `review.service.ts` — Core CRUD

- `getReviewsByProduct(handle, opts)` — paginated, public (status=published)
- `getReviewSummary(productId)` — avg, count, star distribution
- `submitReview(data)` — validate, moderate, store, set status
- `getReviewById(id)` — with media and reply
- `updateReview(id, data)` — admin updates
- `deleteReview(id)` — soft delete (archive)
- `bulkAction(ids, action)` — publish/reject/archive/delete
- `markHelpful(id)` — increment, rate-limit by IP
- `reportReview(id)` — increment, auto-flag if threshold hit

### `review-moderation.service.ts`

- `evaluateReview(review, settings)` → `{ action, reasons }`
- Checks: min rating, verified-only, profanity word list, duplicate content detection

### `review-import.service.ts`

- `parseLooxCsv(buffer)` — map Loox CSV columns to review fields
- `importReviews(parsed, brandId, opts)` — batch upsert, deduplicate by import_source_id, download images to Supabase Storage, match products by handle
- Returns: `{ imported, skipped, failed, errors }`

### `review-email.service.ts`

- `scheduleReviewRequest(order, brandId)` — create review_request on fulfillment
- `processScheduledEmails()` — 5-minute interval, send due request emails
- `processScheduledReminders()` — send due reminder emails
- `generateReviewToken(requestId)` — crypto.randomUUID for secure link
- `renderEmailTemplate(type, data)` — merge template with order/product data
- `cancelRequest(orderId)` — cancel if order cancelled/refunded

### `review-analytics.service.ts`

- `analyzeProductReviews(productId)` — Claude analysis per product
- `analyzeStoreReviews(brandId)` — store-wide analysis
- `extractThemes(reviews)` — topic extraction with sentiment
- `detectTrends(reviews, timeRange)` — sentiment over time
- `generateActionItems(analysis)` — ranked recommendations
- `suggestReplyDraft(review)` — AI reply suggestion
- Cache results in `review_analytics_cache` with 24h TTL

### `product-sync.service.ts`

- `fullSync(brandId)` — fetch all products from Shopify Admin API, upsert
- `handleProductWebhook(topic, payload)` — create/update/delete handlers
- `registerWebhooks(brandId)` — register product + order webhooks

### `review-settings.service.ts`

- `getSettings(brandId)` — returns settings with defaults
- `updateSettings(brandId, partial)` — merge update
- `getWidgetDesign(brandId)` — extract widget_design from settings
- `updateWidgetDesign(brandId, design)` — update widget_design

---

## Webhook Endpoints

Added to `index.ts`:

```
POST /api/webhooks/shopify/products — HMAC verified
  topics: products/create, products/update, products/delete

POST /api/webhooks/shopify/orders — HMAC verified
  topic: orders/fulfilled → schedule review request
```

## Email Job Runner

`setInterval` in backend startup (every 5 minutes):
1. Query `review_requests` where `status = 'scheduled' AND scheduled_for <= now()` → send emails, update to `sent`
2. Query `review_requests` where `status = 'sent' AND reminder_scheduled_for <= now()` → send reminders, update to `reminded`
3. Query `review_requests` where `status IN ('sent','reminded') AND created_at < now() - 30 days` → expire

---

## Admin Dashboard Pages

New sidebar group "Reviews" with these pages:

### `/reviews` — All Reviews
Data table: customer, product, rating (stars), status (badge), verified, source, date, media count. Filters: status, rating, product, date range, source, has-media. Bulk actions toolbar. Row click → detail slide-out with full review, media gallery, reply editor, moderation log.

### `/reviews/products` — Products
Synced products table: thumbnail, title, handle, review count, avg rating, Shopify status. "Sync Now" button triggers full sync. Click → filtered reviews for that product.

### `/reviews/playground` — Widget Playground
Split view: iframe preview (left) + debug panel (right). Same pattern as returns playground. Posts messages for events: review loaded, form opened, review submitted.

### `/reviews/emails` — Email Templates
List of template types (request, reminder, thank_you). Click → editor with subject, HTML body, variable insertion ({{customer_name}}, {{product_title}}, {{review_link}}, etc.), preview.

### `/reviews/design` — Widget Design
Controls: star color, background, text color, font family, heading font, border radius, card style, button style, reviews per page, sort options. Live iframe preview. Preset themes. Same pattern as returns design page.

### `/reviews/analytics` — AI Analytics
Stat cards: total reviews, avg rating, collection rate, response rate. Charts: rating distribution bar chart, reviews over time line chart, sentiment trend. AI sections: theme cards with sentiment bars, trend alerts, ranked action items, per-product comparison table. "Refresh Analysis" button.

### `/reviews/import` — Import
CSV upload dropzone. Format selector (Loox preset, extensible). Preview table showing mapped fields. Confirm button with progress bar. Results summary.

### `/reviews/settings` — Settings
Collapsible sections: Collection (timing, reminders), Moderation (auto-publish rules), Display (per page, sort, badges), FTC Compliance (disclosure text), Email Sender (from name/email).

---

## Storefront Widget

### Build

New Vite entry: `apps/widget/src/review-widget.ts` → `dist/review-widget.js`
Served from backend: `GET /widget/review-widget.js`

### Embed

```html
<div id="outlight-reviews" data-product-handle="aven"></div>
<script src="https://backend-url/widget/review-widget.js"></script>
```

### Design (from reference images)

**Header section:**
- "CUSTOMER REVIEWS" — small caps, letter-spacing 3px, color #C4A265 (gold)
- Stars: filled gold (#C4A265), large rating number beside them
- "Based on X verified reviews" — gray subtitle
- "WRITE A REVIEW" — outlined button, uppercase, letter-spaced

**Review cards:**
- Desktop: 2-column grid with gap
- Mobile: single column stack
- Each card:
  - Top row: customer name (bold) + verified badge (green dot ●) + date (right, gray)
  - Gold stars row
  - Review body in quotes
  - Photo thumbnails (60x60px squares, slight rounding)
  - Variant label: "ITEM: Aven — Large (57.1\")" in small muted text
  - Owner reply (if exists): indented block below body
- Divider: subtle bottom border between cards

**Colors:**
- Stars: #C4A265
- Heading text: #C4A265
- Body text: #333
- Dates/labels: #999
- Verified badge: #22c55e (green dot)
- Background: #fff
- Card borders: #eee

**Typography:**
- Body: system font or customizable
- Headings: can be set separately

**Interactions:**
- "Write a Review" → modal overlay with: star rating picker, optional title, body textarea, photo upload (drag & drop), name, email, variant dropdown
- "Load More" button for pagination
- Photo click → lightbox/modal

### Customization

All visual properties configurable via `widget_design` JSON in `review_settings`:
```json
{
  "starColor": "#C4A265",
  "starStyle": "filled",
  "backgroundColor": "#ffffff",
  "textColor": "#333333",
  "headingColor": "#C4A265",
  "headingFontFamily": "",
  "bodyFontFamily": "",
  "fontSize": "medium",
  "borderRadius": "rounded",
  "cardStyle": "bordered",
  "buttonStyle": "outlined",
  "buttonText": "WRITE A REVIEW",
  "headerText": "CUSTOMER REVIEWS",
  "reviewsPerPage": 10,
  "defaultSort": "newest",
  "showVerifiedBadge": true,
  "showVariant": true,
  "showDate": true,
  "showPhotos": true,
  "layout": "grid"
}
```

---

## Import Pipeline

### Loox CSV Format Mapping

| CSV Column | Review Field | Notes |
|---|---|---|
| id | import_source_id | dedup key |
| status | status | "Active" → "published" |
| rating | rating | 1-5 |
| email | customer_email | |
| nickname | customer_nickname | |
| full_name | customer_name | |
| review | body | |
| date | submitted_at | ISO 8601 |
| handle | → product lookup by handle | |
| variant | variant_title | |
| verified_purchase | verified_purchase | "true"/"false" |
| img | → download to Supabase Storage → review_media | comma-separated URLs |
| orderId | shopify_order_id | |
| incentivized | incentivized | "true"/"false" |
| reply | → review_replies.body | if non-empty |
| replied_at | → review_replies.created_at | |

### Process

1. Parse CSV with Loox column mapping
2. For each row: match product by handle, create review, download images
3. Deduplicate by import_source_id (skip existing)
4. Batch process (50 at a time) with progress reporting
5. Image download: fetch from Loox URL → upload to Supabase Storage → save review_media record

---

## Email Collection Flow

```
Shopify Order Fulfilled (webhook)
    │
    ├─ Check: request_enabled in settings?
    ├─ Check: customer email exists?
    ├─ Check: no existing request for this order?
    │
    ▼
Create review_request
  status: scheduled
  scheduled_for: now() + request_delay_days
  token: crypto.randomUUID()
    │
    ▼ (cron at scheduled_for)
Send Request Email
  Contains: product images, review link with token
  status → sent
  reminder_scheduled_for: now() + reminder_delay_days
    │
    ├── Customer clicks link → Submit form → status: completed
    │
    ▼ (no response, cron at reminder_scheduled_for)
Send Reminder Email
  status → reminded
    │
    ├── Customer clicks link → Submit form → status: completed
    │
    ▼ (30 days, no response)
  status → expired
```

---

## AI Analytics

### Analysis Types

**Sentiment** — per-product and store-wide sentiment scores (1-5 scale aligned with star ratings), sentiment keyword extraction.

**Themes** — extract recurring topics from review text (e.g., "packaging", "delivery speed", "build quality", "customer service"). Each theme gets: mention count, average sentiment, representative quotes.

**Trends** — compare sentiment and volume across time periods. Detect significant changes (e.g., "Delivery complaints increased 40% this month").

**Actions** — AI-generated actionable recommendations ranked by impact. Example: "23 reviews mention long shipping times. Consider adding estimated delivery dates to product pages."

### Claude Prompt

Input: batched review texts with metadata (rating, date, product, variant).
Output: structured JSON matching the analysis_type schemas.
Cache results in `review_analytics_cache` with 24h TTL.
Refresh: manual button or auto when review_count changes by 10+.

### Reply Suggestions

On individual review detail in admin, "Draft Reply" button sends the review to Claude with brand voice context. Returns a suggested reply the admin can edit before publishing.

---

## FTC Compliance

- Incentivized reviews display disclosure text (configurable) on the storefront widget
- Verified purchase badge tied to real Shopify order ID validation
- No suppression of negative reviews — rejected reviews require explicit reason, logged
- All review statuses auditable
- Incentivized flag preserved from import and set on new incentivized reviews

---

## File Structure (New Files)

### Backend (`apps/backend/src/`)
```
controllers/review.controller.ts
services/review.service.ts
services/review-moderation.service.ts
services/review-import.service.ts
services/review-email.service.ts
services/review-analytics.service.ts
services/review-settings.service.ts
services/product-sync.service.ts
```

### Widget (`apps/widget/src/`)
```
review-widget.ts          (entry point)
ui/ReviewWidget.ts        (main component)
ui/ReviewHeader.ts        (summary + write button)
ui/ReviewCard.ts          (individual review)
ui/ReviewForm.ts          (submission modal)
ui/ReviewPhotos.ts        (photo gallery + lightbox)
styles/review-widget.css  (styles)
```

### Admin (`apps/admin/src/app/`)
```
(dashboard)/reviews/page.tsx                    (all reviews)
(dashboard)/reviews/products/page.tsx           (products)
(dashboard)/reviews/playground/page.tsx         (widget preview)
(dashboard)/reviews/emails/page.tsx             (email templates list)
(dashboard)/reviews/emails/[type]/page.tsx      (edit template)
(dashboard)/reviews/design/page.tsx             (widget design)
(dashboard)/reviews/analytics/page.tsx          (AI insights)
(dashboard)/reviews/import/page.tsx             (CSV import)
(dashboard)/reviews/settings/page.tsx           (settings)

api/reviews/route.ts                            (list, bulk)
api/reviews/[id]/route.ts                       (CRUD)
api/reviews/[id]/reply/route.ts                 (reply CRUD)
api/reviews/import/route.ts                     (import endpoint)
api/reviews/products/route.ts                   (product list)
api/reviews/products/sync/route.ts              (trigger sync)
api/reviews/settings/route.ts                   (settings)
api/reviews/design/route.ts                     (widget design)
api/reviews/emails/route.ts                     (template list)
api/reviews/emails/[type]/route.ts              (template CRUD)
api/reviews/analytics/route.ts                  (AI analytics)
api/reviews/analytics/refresh/route.ts          (trigger analysis)
api/reviews/stats/route.ts                      (dashboard stats)
api/reviews/upload/route.ts                     (media upload proxy)
```
