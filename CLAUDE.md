# CLAUDE.md — Master Project Instructions

## What This Project Is

An AI-powered customer support chatbot for a Shopify store called "put1rp-iq". Three-part system:

1. **Backend API server** — Node.js + TypeScript + Express. Orchestrates AI conversations, routes tool calls to Shopify MCP and Admin API, stores data in Supabase. Deployed on Railway.
2. **Chat widget** — Lightweight vanilla JS + CSS bundle. Floating chatbot UI embedded on the Shopify storefront. Served from a CDN or the backend itself.
3. **Admin dashboard** — Next.js app for monitoring conversations, analytics, KB management, and AI configuration. Deployed on Vercel. (Deferred to post-MVP, but the backend should be designed to support it.)

The MVP scope is: backend API + chat widget. The admin dashboard comes later.

---

## Architecture

```
Customer on Shopify Store
        │
        ▼
┌─────────────────┐         ┌──────────────────────────────────────┐
│  Chat Widget    │  HTTPS  │  Backend API (Railway)                │
│  (JS on store)  │────────▶│                                      │
│                 │◀────────│  Express + TypeScript                 │
└─────────────────┘         │                                      │
                            │  ┌──────────────────────────────┐    │
                            │  │  AI Orchestration Layer       │    │
                            │  │  - Builds system prompt       │    │
                            │  │  - Calls Claude API           │    │
                            │  │  - Handles tool-use loop      │    │
                            │  │  - Routes tools to services   │    │
                            │  └──────┬──────────┬─────────────┘    │
                            │         │          │                  │
                            │    ┌────┴───┐ ┌────┴──────────┐      │
                            │    │Shopify │ │Shopify Admin  │      │
                            │    │Store   │ │API (GraphQL)  │      │
                            │    │MCP     │ │via client     │      │
                            │    │Server  │ │credentials    │      │
                            │    │(no auth│ │grant          │      │
                            │    │needed) │ │               │      │
                            │    └────────┘ └───────────────┘      │
                            │         │                             │
                            │    ┌────┴──────────────────────┐     │
                            │    │  Supabase                  │     │
                            │    │  - Conversations + Messages│     │
                            │    │  - Knowledge Base docs      │    │
                            │    │  - AI Config                │    │
                            │    │  - Realtime (for dashboard) │    │
                            │    └────────────────────────────┘     │
                            └──────────────────────────────────────┘
```

---

## Critical Technical Details

### Shopify Authentication (Dev Dashboard App — Post-Jan 2026)

There are NO static API access tokens. The app was created in the Shopify Dev Dashboard. Authentication uses the **client credentials grant**:

- POST to `https://put1rp-iq.myshopify.com/admin/oauth/access_token`
- Body: `grant_type=client_credentials`, `client_id={SHOPIFY_CLIENT_ID}`, `client_secret={SHOPIFY_CLIENT_SECRET}`
- Content-Type: `application/x-www-form-urlencoded`
- Returns: `{ access_token, scope, expires_in }` where `expires_in` is 86399 (24 hours)
- The backend MUST cache this token in memory and auto-refresh it before expiry (refresh when less than 60 seconds remain)
- A dedicated auth service manages all token lifecycle — every other Shopify service calls it to get a valid token

### Shopify Storefront MCP Server

- Endpoint: `https://put1rp-iq.myshopify.com/api/mcp`
- Protocol: JSON-RPC 2.0
- No authentication required
- Available tools (confirmed working):
  - `search_shop_catalog` — Product search. Required inputs: `query` (string), `context` (string). Optional: `filters`, `country`, `language`, `limit`, `after`
  - `get_product_details` — Product lookup by ID. Required: `product_id`. Optional: `options` (variant selection), `country`, `language`
  - `search_shop_policies_and_faqs` — Policy/FAQ answers. Required: `query`, `context`
  - `update_cart` — Create/modify cart. Optional `cart_id` (omit to create new). `add_items`, `update_items`, `remove_line_ids`, `buyer_identity`, discount/gift card codes, delivery addresses
  - `get_cart` — Get cart contents. Required: `cart_id`

### Shopify Admin API (GraphQL)

- Endpoint: `https://put1rp-iq.myshopify.com/admin/api/2025-01/graphql.json`
- Auth: `X-Shopify-Access-Token` header with the token from the client credentials grant
- Used for: order lookup, customer verification, return eligibility, return initiation
- Available scopes: `read_orders`, `read_products`, `read_customers`, `read_content`, `read_shipping`, `read_inventory`, `read_fulfillments`, `write_returns`, `read_discounts`, `write_discounts`

### Supabase

- Claude Code has Supabase MCP access and can create tables, run queries, manage the schema directly
- Project ref: `wwblkodkycjwmzlflncg`
- Use Supabase MCP tools to create tables, insert seed data, and verify schema
- The backend connects to Supabase using the `@supabase/supabase-js` SDK with the service role key
- All tables should have Row Level Security enabled with a permissive policy for the service role

### Deployment

- **Backend** → Railway (Claude Code has Railway MCP access for deployment, logs, domains)
- **Dashboard** → Vercel (Claude Code has Vercel MCP access — deferred to post-MVP)
- **Widget JS** → Served from the backend as a static file, or from a CDN later

---

## Tech Stack

| Component | Technology |
|---|---|
| Backend runtime | Node.js 20+ |
| Backend framework | Express |
| Language | TypeScript (strict mode) |
| AI | Anthropic Claude API (`@anthropic-ai/sdk`), model: `claude-sonnet-4-20250514` |
| Database | Supabase (Postgres) via `@supabase/supabase-js` |
| Shopify Admin | Raw fetch with GraphQL (no Shopify SDK — it doesn't support client credentials grant cleanly) |
| Shopify MCP | Raw fetch with JSON-RPC 2.0 |
| Widget | Vanilla JS + CSS, bundled with esbuild or vite |
| Package manager | npm |
| Dev runner | tsx (for running TypeScript directly in development) |

---

## Coding Conventions

- TypeScript strict mode everywhere
- Async/await, never callbacks
- Service layer pattern: controllers handle HTTP requests/responses, services handle business logic
- All external API calls (Claude, Shopify, Supabase) wrapped in try-catch with meaningful error messages
- Environment variables validated at startup — fail fast with clear error if any are missing
- No classes unless genuinely needed — prefer functions and modules
- Use named exports, not default exports
- Error responses to clients: `{ error: string, details?: string }` — never expose stack traces or internal details
- Log errors to console with context (service name, operation, relevant IDs) but keep logs concise
- All Shopify Admin API calls go through the auth service for token management
- Use `context` field in MCP tool calls — populate from conversation context (page URL, customer mood, etc.)

---

## Environment Variables

Reference `.env.example` for the complete list. Key variables:

- `SHOPIFY_SHOP` — Just the store name: `put1rp-iq` (not the full domain)
- `SHOPIFY_CLIENT_ID` — From Dev Dashboard → Settings
- `SHOPIFY_CLIENT_SECRET` — From Dev Dashboard → Settings
- `SHOPIFY_API_VERSION` — `2025-01`
- `ANTHROPIC_API_KEY` — For Claude API
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — For backend access (NOT the anon key)
- `PORT` — Server port (default 3001, Railway will override)
- `NODE_ENV` — `development` or `production`
- `CORS_ORIGIN` — Allowed origins for CORS (the Shopify store domain in production)

---

## Project Structure

```
shopify-ai-chatbot/
├── apps/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── config/
│   │   │   │   ├── env.ts
│   │   │   │   └── supabase.ts
│   │   │   ├── controllers/
│   │   │   │   ├── chat.controller.ts
│   │   │   │   └── health.controller.ts
│   │   │   ├── services/
│   │   │   │   ├── ai.service.ts
│   │   │   │   ├── shopify-auth.service.ts
│   │   │   │   ├── shopify-mcp.service.ts
│   │   │   │   ├── shopify-admin.service.ts
│   │   │   │   ├── conversation.service.ts
│   │   │   │   └── knowledge.service.ts
│   │   │   ├── tools/
│   │   │   │   ├── definitions.ts
│   │   │   │   └── router.ts
│   │   │   └── types/
│   │   │       └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── widget/
│       ├── src/
│       │   ├── widget.ts
│       │   ├── ui/
│       │   │   ├── ChatWindow.ts
│       │   │   ├── MessageList.ts
│       │   │   ├── InputBar.ts
│       │   │   ├── FloatingButton.ts
│       │   │   ├── PresetActions.ts
│       │   │   └── Header.ts
│       │   ├── api/
│       │   │   └── client.ts
│       │   ├── state/
│       │   │   └── store.ts
│       │   └── styles/
│       │       └── widget.css
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
│
├── .env.example
├── .env
├── .gitignore
├── package.json
├── CLAUDE.md
└── README.md
```

---

## Database Schema

### Table: conversations

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| shopify_customer_id | text | nullable |
| customer_email | text | nullable |
| customer_name | text | nullable |
| customer_phone | text | nullable |
| status | text | default 'active', check in ('active','closed','escalated') |
| page_url | text | nullable |
| started_at | timestamptz | default now() |
| ended_at | timestamptz | nullable |
| last_message_at | timestamptz | nullable |
| message_count | integer | default 0 |
| satisfaction_score | integer | nullable, check between 1 and 5 |
| resolved | boolean | default false |
| metadata | jsonb | nullable |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Indexes: status, started_at, customer_email

### Table: messages

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| conversation_id | uuid | FK → conversations.id, ON DELETE CASCADE |
| role | text | check in ('user','assistant','system','human_agent') |
| content | text | not null |
| model | text | nullable |
| tokens_input | integer | nullable |
| tokens_output | integer | nullable |
| latency_ms | integer | nullable |
| tools_used | jsonb | nullable |
| created_at | timestamptz | default now() |

Indexes: (conversation_id, created_at) composite, created_at

### Table: knowledge_documents

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| title | text | not null |
| content | text | not null |
| category | text | not null |
| enabled | boolean | default true |
| priority | integer | default 0 |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

Indexes: (category, enabled) composite

### Table: ai_config

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| key | text | unique, not null |
| value | text | not null |
| updated_at | timestamptz | default now() |

---

## Seed Data

### ai_config entries:

**key: `system_prompt`**
Value: Comprehensive system prompt instructing Claude as customer support assistant.

**key: `brand_voice`**
Value: Friendly and helpful. Speak like a knowledgeable store associate, not a corporate robot.

**key: `greeting`**
Value: "Hi there! 👋 How can I help you today?"

**key: `preset_actions`**
Value (JSON string): Array of 5 preset actions (track order, start return, find products, shipping info, talk to human).

---

## Claude Tool Definitions

11 tools: search_products, get_product_details, answer_store_policy, lookup_order, check_return_eligibility, initiate_return, search_knowledge_base, manage_cart, get_cart, navigate_customer, escalate_to_human.

---

## API Endpoints

- GET /health
- POST /api/chat/session
- POST /api/chat/message
- GET /api/widget/config
- GET /widget/widget.js (static)
- GET /widget/widget.css (static)
