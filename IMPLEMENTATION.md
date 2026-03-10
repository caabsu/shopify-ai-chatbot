# Implementation Document — Customer Support Platform

## What Was Implemented

### 1. Ticket System Backend (apps/backend)

**New files:**
- `src/services/ticket.service.ts` — Full CRUD for tickets: create, get, list (with filters/pagination/search), update (with event logging), message management, SLA deadline integration, escalation ticket creation
- `src/services/sla.service.ts` — SLA deadline calculation from rules table, breach detection and flagging
- `src/services/customer-profile.service.ts` — Shopify Admin API integration for customer lookup by email, order history retrieval
- `src/services/ai-assistant.service.ts` — AI tools for VAs: draft reply, summarize thread, suggest next steps (all using Claude claude-sonnet-4-20250514)
- `src/services/shopify-actions.service.ts` — Shopify Admin write operations: cancel order, refund order, create discount code
- `src/controllers/ticket.controller.ts` — REST API endpoints for tickets (CRUD, messages, events, AI tools), all behind agent auth
- `src/controllers/agent.controller.ts` — Agent authentication (login/logout), CRUD for agents (admin-only), JWT-based sessions
- `src/middleware/agent-auth.middleware.ts` — JWT verification middleware, token signing, admin role guard

**Modified files:**
- `src/index.ts` — Added ticket/agent routers, public contact form endpoint (`POST /api/tickets/form`), escalation endpoint (`POST /api/tickets/escalate`)
- `src/types/index.ts` — Added Ticket, TicketMessage, TicketEvent, Agent, CannedResponse, SlaRule interfaces
- `src/tools/router.ts` — Updated escalate_to_human to create tickets when customer email is available; added cancel_order routing to shopify-actions
- `package.json` — Added `jose` (JWT), `bcryptjs` (password hashing) dependencies

**New API Endpoints:**
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/tickets/form | Public | Contact form submission |
| POST | /api/tickets/escalate | Public (internal) | AI escalation creates ticket |
| GET | /api/tickets | Agent JWT | List tickets with filters |
| POST | /api/tickets | Agent JWT | Create ticket |
| GET | /api/tickets/:id | Agent JWT | Get ticket with messages/events/customer profile |
| PATCH | /api/tickets/:id | Agent JWT | Update ticket (status, priority, assignment, tags) |
| GET | /api/tickets/:id/messages | Agent JWT | Get ticket messages |
| POST | /api/tickets/:id/messages | Agent JWT | Add message/note to ticket |
| GET | /api/tickets/:id/events | Agent JWT | Get ticket audit log |
| POST | /api/tickets/:id/ai/draft | Agent JWT | AI draft reply |
| POST | /api/tickets/:id/ai/summarize | Agent JWT | AI thread summary |
| POST | /api/tickets/:id/ai/suggest | Agent JWT | AI suggested next steps |
| POST | /api/agents/login | Public | Agent login |
| POST | /api/agents/logout | Public | Agent logout |
| GET | /api/agents/me | Agent JWT | Current agent info |
| GET | /api/agents | Admin JWT | List all agents |
| POST | /api/agents | Admin JWT | Create agent |
| PATCH | /api/agents/:id | Admin JWT | Update agent |

### 2. Contact Form Widget (apps/widget)

**New files:**
- `src/contact-form.ts` — Self-contained embeddable contact form widget (IIFE bundle)
  - Fields: name, email, category dropdown, order number (optional), subject, message
  - Honeypot spam prevention
  - Posts to `POST /api/tickets/form`
  - Auto-detects backend URL from script src attribute
  - Success state shows ticket number
- `vite.contact-form.config.ts` — Separate Vite build config for the contact form

**Output:** `dist/contact-form.js` (7.78 KB, 2.72 KB gzipped)

### 3. Admin Dashboard (apps/admin)

**Theme System:**
- `src/app/globals.css` — CSS custom properties for light/dark mode, priority/status/source color tokens
- `src/components/theme-provider.tsx` — React context for theme management (light/dark/system), localStorage persistence, system preference detection

**Restructured Navigation:**
- `src/components/sidebar.tsx` — Four groups: Main (Overview), Support (Ticket Inbox, Insights), AI Chatbot (Conversations, Playground, AI Config, Capabilities, Features), Manage (Knowledge Base, Settings)
- `src/components/header.tsx` — Theme toggle (Sun/Moon icons)

**New Pages:**
| Page | Path | Description |
|------|------|-------------|
| Ticket Inbox | /tickets | Full ticket list with sidebar filters (status, source, priority), search, SLA indicators, color-coded priority/status/source badges, pagination |
| VA Workspace | /tickets/[id] | Three-panel layout: conversation thread, customer sidebar (profile, past tickets, AI conversation context), reply composer with canned responses, AI tools (draft, summarize, suggest), internal notes |
| Insights | /insights | Combined analytics for tickets + AI chatbot metrics |
| Settings Hub | /settings | Links to sub-settings pages |
| SLA Rules | /settings/sla | View/manage SLA rules by priority |
| Canned Responses | /settings/canned-responses | CRUD for canned response templates |
| Team Management | /settings/team | Agent management (add, edit, activate/deactivate) |
| General Settings | /settings/general | General configuration |
| Chatbot Conversations | /chatbot/conversations | Moved from /conversations (existing functionality) |
| Chatbot Playground | /chatbot/playground | Moved from /playground (existing functionality) |
| Chatbot AI Config | /chatbot/ai-config | Moved from /ai-config (existing functionality) |
| Chatbot Capabilities | /chatbot/capabilities | Moved from /capabilities (existing functionality) |
| Chatbot Features | /chatbot/features | Moved from /features (existing functionality) |

**New API Routes:**
| Route | Description |
|-------|-------------|
| /api/tickets | List/create tickets |
| /api/tickets/stats | Ticket stats for sidebar badges and overview |
| /api/tickets/[id] | Get/update single ticket with messages, events, customer context |
| /api/tickets/[id]/messages | Add messages to tickets |
| /api/tickets/[id]/ai | AI tools proxy (draft, summarize, suggest) |
| /api/settings/canned-responses | CRUD for canned responses |

**Color Coding System:**
- Priority: Urgent (red), High (orange), Medium (blue), Low (gray)
- Status: Open (blue), Pending (amber), Resolved (green), Closed (gray)
- Source: Email (indigo), Form (emerald), AI Escalation (purple)
- Tags: Cycling through 6 distinct colors

### 4. Database Schema (Supabase)

Created via migration `create_ticket_system_tables`:

**New tables:**
- `tickets` — Core ticket data with auto-incrementing ticket_number (starting at 1001), SLA tracking, status/priority/assignment management
- `ticket_messages` — Ticket conversation thread (customer, agent, system, AI draft messages + internal notes)
- `ticket_events` — Full audit log (status changes, assignments, priority changes, SLA breaches)
- `agents` — VA accounts with bcrypt password hashes, roles (admin/agent)
- `canned_responses` — Reusable reply templates with variables
- `sla_rules` — SLA configuration per priority level

**Modified tables:**
- `conversations` — Added `escalated_ticket_id` column to link AI conversations to escalation tickets
- `knowledge_documents` — Added `visibility`, `usage_count`, `last_used_at` columns

**Seeded data:**
- SLA rules: Urgent (1hr), High (4hr), Medium (8hr), Low (24hr)
- 6 canned responses: Greeting, Order Delay, Return Process, Shipping Info, Escalation Note, Resolution

---

## Manual Steps Required

### 1. Set JWT_SECRET Environment Variable

**Railway (backend):**
```
JWT_SECRET=<generate a secure random string, e.g. openssl rand -base64 32>
```

**Vercel (admin dashboard):**
The dashboard uses its own JWT_SECRET already configured in `.env.production`.

### 2. Create Initial Admin Agent

After deployment, you need to create the first admin agent. Run this SQL in Supabase:

```sql
INSERT INTO agents (name, email, password_hash, role, is_active)
VALUES (
  'Admin',
  'admin@put1rp-iq.com',
  -- This is bcrypt hash of 'changeme123' — CHANGE THIS after first login
  '$2a$10$xEhQKJLqcKMtMgVhQXj2VOQhYhKMGqByXTxnBs4QiJuJ0xCuU.hEy',
  'admin',
  true
);
```

**Important:** Generate a proper password hash for production. You can use:
```bash
node -e "require('bcryptjs').hash('YourSecurePassword', 10).then(console.log)"
```

### 3. Contact Form Embedding

Embed the contact form on your Shopify "Contact Us" page:

**Option A — Auto-create container:**
```html
<script src="https://shopify-ai-chatbot-production-9ab4.up.railway.app/widget/contact-form.js"></script>
```

**Option B — Explicit container:**
```html
<div id="support-contact-form"></div>
<script src="https://shopify-ai-chatbot-production-9ab4.up.railway.app/widget/contact-form.js"></script>
```

### 4. Email Ticket Source (Future)

The email ticket source (`source: 'email'`) is architecturally supported but not yet implemented. To enable it:

1. Set up an email forwarding service (e.g., SendGrid Inbound Parse, Mailgun Routes, or Postmark Inbound)
2. Configure a webhook URL: `POST /api/tickets/email-inbound`
3. Create the `/api/tickets/email-inbound` endpoint that parses the email and calls `ticketService.createTicket({ source: 'email', ... })`
4. Set up DKIM/SPF for reply-from capability

### 5. CORS Configuration

If the admin dashboard calls the backend API directly (for AI tools proxy), add the Vercel domain to `CORS_ORIGIN`:

```
CORS_ORIGIN=https://put1rp-iq.myshopify.com,https://your-admin-dashboard.vercel.app
```

### 6. Backend URL for Admin

Set `BACKEND_URL` in the admin dashboard's environment variables on Vercel:

```
BACKEND_URL=https://shopify-ai-chatbot-production-9ab4.up.railway.app
```

This enables the admin dashboard to proxy AI assistant requests to the backend.

---

## Architecture Overview

```
Customer Journey:
  Shopify Store → AI Chatbot (Layer 1, automated)
                    │
                    ├─ Resolves 70%+ of queries autonomously
                    │
                    └─ Escalates to → Ticket System (Layer 2, human)
                                         │
  Support Email ──────────────────────────┤
  Contact Form ───────────────────────────┤
                                          │
                                     Unified Inbox
                                          │
                                     VA Workspace
                                     (AI-assisted)
```

### What's Preserved
- All existing AI chatbot functionality (chat widget, playground, conversations, AI config, capabilities, features, knowledge base)
- All existing API endpoints
- Widget design/customization system
- Authentication and session management

### What's New
- Full ticket system with SLA tracking
- VA workspace with AI tools (draft, summarize, suggest)
- Agent authentication and management
- Contact form widget
- AI escalation creates tickets with conversation context
- Restructured dashboard navigation
- Dark/light mode theming
- Color-coded priority/status/source system
- Insights page combining AI chatbot + ticket metrics
