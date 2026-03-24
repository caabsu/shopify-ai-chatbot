# Order Tracking Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a "Track Your Order" embeddable widget with 17track API integration, plus admin dashboard pages (playground, design, settings) following existing patterns.

**Architecture:** Embeddable vanilla JS widget (same pattern as review-widget/returns-portal) that lets customers look up orders by order number+email or tracking number directly. Backend service calls Shopify Admin API to verify orders and extract tracking numbers, then calls 17track API for detailed timeline events. Results are cached in Supabase for 2 hours. Admin dashboard provides playground, design customization, and settings (custom status messages, carrier names).

**Tech Stack:** TypeScript, Express, Vite (IIFE bundle), 17track API, Shopify Admin GraphQL API, Supabase, Next.js (admin)

---

## File Structure

### Backend (`apps/backend/src/`)
- **Create:** `services/tracking.service.ts` — 17track API integration, order lookup orchestration, cache management
- **Create:** `services/tracking-settings.service.ts` — design + settings CRUD with defaults
- **Create:** `controllers/tracking.controller.ts` — public widget endpoints + admin endpoints
- **Modify:** `index.ts` — register tracking router + preview page
- **Modify:** `types/index.ts` — add tracking types

### Widget (`apps/widget/src/`)
- **Create:** `tracking-widget.ts` — main entry point, all UI rendering
- **Create:** `styles/tracking-widget.css` — styles matching mockups
- **Create:** `vite.tracking-widget.config.ts` — Vite build config
- **Modify:** `package.json` — add build command

### Admin (`apps/admin/src/`)
- **Create:** `app/(dashboard)/tracking/playground/page.tsx`
- **Create:** `app/(dashboard)/tracking/design/page.tsx`
- **Create:** `app/(dashboard)/tracking/settings/page.tsx`
- **Create:** `app/api/tracking/settings/route.ts`
- **Create:** `app/api/tracking/design/route.ts`
- **Modify:** `components/sidebar.tsx` — add Tracking group

### Database
- **Create:** `tracking_settings` table
- **Create:** `tracking_cache` table

---

## Task 1: Database Tables

**Files:** Supabase migration

- [ ] **Step 1: Create tracking_settings table**

```sql
CREATE TABLE IF NOT EXISTS tracking_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid UNIQUE NOT NULL,
  widget_design jsonb DEFAULT '{}',
  custom_status_messages jsonb DEFAULT '{}',
  carrier_display_names jsonb DEFAULT '{}',
  cache_ttl_minutes integer DEFAULT 120,
  seventeen_track_api_key text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE tracking_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON tracking_settings FOR ALL USING (true);
```

- [ ] **Step 2: Create tracking_cache table**

```sql
CREATE TABLE IF NOT EXISTS tracking_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number text NOT NULL,
  carrier text,
  brand_id uuid NOT NULL,
  data jsonb NOT NULL,
  fetched_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE(tracking_number, brand_id)
);

ALTER TABLE tracking_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON tracking_cache FOR ALL USING (true);
CREATE INDEX idx_tracking_cache_lookup ON tracking_cache(tracking_number, brand_id);
CREATE INDEX idx_tracking_cache_expires ON tracking_cache(expires_at);
```

- [ ] **Step 3: Commit**

---

## Task 2: Backend Types

**Files:**
- Modify: `apps/backend/src/types/index.ts`

- [ ] **Step 1: Add tracking types**

Add to the types file:

```typescript
// ── Tracking ──
export interface TrackingEvent {
  status: string;
  description: string;
  location: string;
  timestamp: string;
}

export interface TrackingResult {
  trackingNumber: string;
  carrier: string;
  carrierDisplay: string;
  status: 'not_found' | 'info_received' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'exception' | 'expired';
  statusMessage: string;
  statusDetail: string;
  estimatedDelivery: string | null;
  signedBy: string | null;
  deliveredAt: string | null;
  events: TrackingEvent[];
  order: TrackingOrderInfo | null;
}

export interface TrackingOrderInfo {
  orderNumber: string;
  lineItems: Array<{
    title: string;
    variant: string | null;
    quantity: number;
    price: string;
    imageUrl: string | null;
  }>;
  destination: string | null;
  transitDays: number | null;
  total: string | null;
}

export interface TrackingWidgetDesign {
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  headingColor: string;
  headingFontFamily: string;
  bodyFontFamily: string;
  statusFontFamily: string;
  buttonColor: string;
  buttonTextColor: string;
  headerText: string;
  headerSubtext: string;
  buttonText: string;
  tabOrderLabel: string;
  tabTrackingLabel: string;
  timelineSectionLabel: string;
  orderDetailsSectionLabel: string;
  deliveredIcon: string;
  inTransitIcon: string;
  exceptionIcon: string;
}

export interface TrackingSettings {
  id: string;
  brand_id: string;
  widget_design: TrackingWidgetDesign;
  custom_status_messages: Record<string, string>;
  carrier_display_names: Record<string, string>;
  cache_ttl_minutes: number;
  seventeen_track_api_key: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Commit**

---

## Task 3: Tracking Settings Service

**Files:**
- Create: `apps/backend/src/services/tracking-settings.service.ts`

- [ ] **Step 1: Create service**

Follow the exact pattern from `review-settings.service.ts`:
- In-memory cache with 5-minute TTL
- `getTrackingSettings(brandId)` — returns settings, creates defaults if missing
- `updateTrackingSettings(brandId, updates)` — partial update
- `DEFAULT_WIDGET_DESIGN` with all the design properties matching the mockup aesthetic
- `DEFAULT_TRACKING_SETTINGS` with sensible defaults
- `DEFAULT_STATUS_MESSAGES` map: `{ delivered: 'Your order has arrived.', in_transit: 'Your order is on its way.', out_for_delivery: 'Out for delivery today.', info_received: 'Shipping label created.', exception: 'Delivery exception — contact support.', expired: 'Tracking information expired.', not_found: 'Tracking information not available yet.' }`
- `DEFAULT_CARRIER_NAMES` map: `{ usps: 'USPS', ups: 'UPS', fedex: 'FedEx', dhl: 'DHL', yanwen: 'Yanwen', 'china-post': 'China Post', 'china-ems': 'China EMS' }`

Default widget design values:
```typescript
{
  accentColor: '#C5A059',
  backgroundColor: '#F9F9FB',
  textColor: '#2D3338',
  headingColor: '#C5A059',
  headingFontFamily: 'Newsreader',
  bodyFontFamily: 'Manrope',
  statusFontFamily: 'Newsreader',
  buttonColor: '#C5A059',
  buttonTextColor: '#ffffff',
  headerText: 'Track Your Order',
  headerSubtext: 'Enter your details below to view real-time shipping updates.',
  buttonText: 'TRACK ORDER',
  tabOrderLabel: 'ORDER NUMBER',
  tabTrackingLabel: 'TRACKING NUMBER',
  timelineSectionLabel: 'TRACKING TIMELINE',
  orderDetailsSectionLabel: 'ORDER DETAILS',
  deliveredIcon: 'checkmark',
  inTransitIcon: 'truck',
  exceptionIcon: 'alert',
}
```

- [ ] **Step 2: Commit**

---

## Task 4: Tracking Service (17track + Shopify)

**Files:**
- Create: `apps/backend/src/services/tracking.service.ts`

- [ ] **Step 1: Create the service**

Functions:
- `lookupByOrder(orderNumber, email, brandId)` — calls Shopify Admin API to find order, verify email, extract tracking numbers + line items, then call 17track for each tracking number. Returns `TrackingResult`.
- `lookupByTracking(trackingNumber, brandId)` — calls 17track directly. Returns `TrackingResult` without order info.
- `fetchFromSeventeenTrack(trackingNumber, brandId)` — check cache first, if expired/missing call 17track Register+GetTrackInfo APIs, parse response into `TrackingEvent[]`, cache result.
- `parseSeventeenTrackResponse(data)` — map 17track status codes to our status enum + extract events.

17track API integration:
- Register endpoint: `POST https://api.17track.net/track/v2.2/register` with `[{ "number": trackingNumber }]`
- Get track info: `POST https://api.17track.net/track/v2.2/gettrackinfo` with `[{ "number": trackingNumber }]`
- Auth header: `17token: <api_key>`
- Response parsing: map `track.e` (event code) to status, `track.z0.z` array for events

Cache logic:
- Before calling 17track, check `tracking_cache` table
- If cached and not expired, return cached data
- After fetching from 17track, upsert into cache with `expires_at = now() + cache_ttl_minutes`

Order lookup enhancement:
- Use existing `shopifyAdmin.lookupOrder()` to get order data
- Verify email matches (case-insensitive)
- Extract all tracking numbers from fulfillments
- Calculate transit days from order creation to delivery/now
- Build `TrackingOrderInfo` with line items, destination, total

- [ ] **Step 2: Commit**

---

## Task 5: Tracking Controller

**Files:**
- Create: `apps/backend/src/controllers/tracking.controller.ts`
- Modify: `apps/backend/src/index.ts`

- [ ] **Step 1: Create controller with routes**

Routes:
```
POST /lookup            — Public: { order_number, email } → TrackingResult
POST /track             — Public: { tracking_number } → TrackingResult
GET  /widget/config     — Public: widget design settings
GET  /admin/settings    — Admin: full settings
PUT  /admin/settings    — Admin: update settings
GET  /admin/design      — Admin: widget design only
PUT  /admin/design      — Admin: update widget design
```

Rate limiting: 10 requests per IP per minute for lookup/track endpoints.

- [ ] **Step 2: Register router in index.ts**

Add `import { trackingRouter } from './controllers/tracking.controller.js';` and `app.use('/api/tracking', trackingRouter);`

- [ ] **Step 3: Add preview page in index.ts**

Add `GET /widget/preview-tracking` route that serves an HTML page with the tracking widget embedded (same pattern as `preview-reviews`).

- [ ] **Step 4: Commit**

---

## Task 6: Widget — CSS

**Files:**
- Create: `apps/widget/src/styles/tracking-widget.css`

- [ ] **Step 1: Write all CSS**

Must match mockups exactly:
- Import Manrope + Newsreader fonts
- `.otw-` prefix (outlight tracking widget)
- Container: max-width 720px, centered, #F9F9FB background
- Header: "ORDER TRACKING" small-caps gold, "Track Your Order" Newsreader italic 42px, subtitle Manrope 300 gray
- Tab bar: uppercase letter-spaced tabs, active = black text + 2px gold bottom border, inactive = #ADADAD
- Form inputs: 1px #D4D4D8 border, no border-radius, Manrope placeholder
- Button: full-width, #C5A059 gold bg, white text, uppercase letter-spaced, no border-radius
- Status section: centered icon, Newsreader italic heading, Manrope 300 detail
- Timeline: vertical dots + lines, recent = solid black dots + bold text, older = gray dots + light text
- Order details: product thumbnails 64x64, product name bold, variant gray, price right-aligned
- Footer: destination + transit left, total right in gold
- Responsive: single column on mobile, compact padding, truncated tracking number
- Loading spinner, error state
- All backgrounds #F9F9FB, card sections white with 1px border

- [ ] **Step 2: Commit**

---

## Task 7: Widget — TypeScript

**Files:**
- Create: `apps/widget/src/tracking-widget.ts`

- [ ] **Step 1: Write the widget**

Structure (single file, same pattern as review-widget.ts):
- Types: `TrackingEvent`, `TrackingResult`, `TrackingOrderInfo`, `DesignConfig`, `WidgetState`
- `getScriptInfo()` — extract backend URL and brand from script tag
- `init()` — find container `#outlight-tracking` or `[data-outlight-tracking]`, fetch config, create widget
- State: `{ activeTab, orderNumber, email, trackingNumber, loading, error, result, showAllEvents }`
- `renderForm(state, design)` — tab bar + inputs + button
- `renderResults(result, design, state)` — status header + timeline + order details
- `renderTimeline(events, design, state)` — vertical timeline with show more
- `renderOrderDetails(order, design)` — product list + footer
- `renderStatusIcon(status)` — SVG icons for each status
- Form submission: POST to `/api/tracking/lookup` or `/api/tracking/track`
- Copy tracking number to clipboard on click
- "SHOW X MORE EVENTS" toggle
- Listen for `otw:design_update` postMessage for admin playground live preview
- Post `otw:loaded`, `otw:lookup`, `otw:result`, `otw:error` events for playground debug

- [ ] **Step 2: Commit**

---

## Task 8: Widget Build Config

**Files:**
- Create: `apps/widget/vite.tracking-widget.config.ts`
- Modify: `apps/widget/package.json`

- [ ] **Step 1: Create Vite config**

Same pattern as `vite.review-widget.config.ts` with CSS injection plugin. Entry: `src/tracking-widget.ts`, output: `tracking-widget.js`, format: IIFE, name: `OutlightTrackingWidget`.

- [ ] **Step 2: Add to package.json build script**

Append `&& vite build --config vite.tracking-widget.config.ts` to the build script.

- [ ] **Step 3: Build and verify**

Run: `npx vite build --config vite.tracking-widget.config.ts`

- [ ] **Step 4: Commit**

---

## Task 9: Admin API Routes

**Files:**
- Create: `apps/admin/src/app/api/tracking/settings/route.ts`
- Create: `apps/admin/src/app/api/tracking/design/route.ts`

- [ ] **Step 1: Create settings route**

GET + PUT, proxy to backend `/api/tracking/admin/settings`. Same auth pattern as reviews settings route.

- [ ] **Step 2: Create design route**

GET + PUT, proxy to backend `/api/tracking/admin/design`. Same pattern.

- [ ] **Step 3: Commit**

---

## Task 10: Admin Sidebar

**Files:**
- Modify: `apps/admin/src/components/sidebar.tsx`

- [ ] **Step 1: Add Tracking group**

Add after Returns group:
```typescript
{
  label: 'Order Tracking',
  collapsible: true,
  defaultCollapsed: false,
  items: [
    { href: '/tracking/playground', label: 'Playground', icon: TestTube },
    { href: '/tracking/design', label: 'Widget Design', icon: Palette },
    { href: '/tracking/settings', label: 'Settings', icon: Settings },
  ],
},
```

- [ ] **Step 2: Commit**

---

## Task 11: Admin Playground Page

**Files:**
- Create: `apps/admin/src/app/(dashboard)/tracking/playground/page.tsx`

- [ ] **Step 1: Create playground**

Same pattern as reviews playground: iframe left panel showing `/widget/preview-tracking`, debug events panel on right. Listen for `otw:*` postMessage events. Reset button, standalone link.

- [ ] **Step 2: Commit**

---

## Task 12: Admin Design Page

**Files:**
- Create: `apps/admin/src/app/(dashboard)/tracking/design/page.tsx`

- [ ] **Step 1: Create design page**

Same pattern as reviews design page with live iframe preview. Controls:
- Colors: accent (gold), background, text, heading, button bg, button text — with presets
- Fonts: heading, body, status heading
- Text: header text, subtitle, button text, tab labels, section labels
- Status messages: editable per status (delivered, in_transit, out_for_delivery, etc.)
- Carrier display names: editable list
- Live iframe preview via postMessage `otw:design_update`
- Save/Reset buttons

- [ ] **Step 2: Commit**

---

## Task 13: Admin Settings Page

**Files:**
- Create: `apps/admin/src/app/(dashboard)/tracking/settings/page.tsx`

- [ ] **Step 1: Create settings page**

Sections:
- **API Configuration:** 17track API key input (masked), test connection button
- **Cache:** TTL in minutes (default 120)
- **Status Messages:** editable messages for each tracking status
- **Carrier Names:** add/edit/remove carrier slug → display name mappings

- [ ] **Step 2: Commit**

---

## Task 14: Deploy & Verify

- [ ] **Step 1: Build all widgets**

```bash
cd apps/widget && npx vite build --config vite.tracking-widget.config.ts
```

- [ ] **Step 2: Deploy backend to Railway**
- [ ] **Step 3: Deploy admin to Vercel**
- [ ] **Step 4: Verify playground loads and renders**
- [ ] **Step 5: Final commit and push**
