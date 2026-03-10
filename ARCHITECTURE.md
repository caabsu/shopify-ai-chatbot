# Customer Support System Architecture

## Full-Stack Customer Support Platform for Shopify

---

## Table of Contents

1. [Vision & Philosophy](#1-vision--philosophy)
2. [System Overview](#2-system-overview)
3. [Customer Journey](#3-customer-journey)
4. [Architecture Diagram](#4-architecture-diagram)
5. [Ticket System Design](#5-ticket-system-design)
6. [Three Ticket Sources](#6-three-ticket-sources)
7. [Unified Ticket Inbox](#7-unified-ticket-inbox)
8. [AI Agent Tools for VAs](#8-ai-agent-tools-for-vas)
9. [Shopify Integration & Actions](#9-shopify-integration--actions)
10. [Dashboard Architecture](#10-dashboard-architecture)
11. [Database Schema](#11-database-schema)
12. [Knowledge Base System](#12-knowledge-base-system)
13. [Insights & Analytics](#13-insights--analytics)
14. [Email System](#14-email-system)
15. [Contact Form](#15-contact-form)
16. [API Design](#16-api-design)
17. [Deployment Architecture](#17-deployment-architecture)
18. [Implementation Phases](#18-implementation-phases)

---

## 1. Vision & Philosophy

This is an **in-house, full-coverage customer support platform** for a Shopify store. It is designed around one principle: **every single customer inquiry, no matter how it arrives, funnels into a single system where it gets resolved**.

The system has two layers:

- **Layer 1 (AI Chatbot)** --- Handles the majority of customer inquiries autonomously. Product questions, order tracking, return eligibility, policy questions, cart help. Already built, already deployed, already working.
- **Layer 2 (Human Ticket System)** --- Everything the AI cannot or should not handle. Complex disputes, custom requests, emotional customers, edge cases. A human VA works these tickets with AI-powered tools and full Shopify context.

**No inquiry falls through the cracks.** Every email, every form submission, every AI escalation becomes a ticket. Every ticket gets worked until resolved.

**No live chat from humans.** All human support is async ticket-based. The VA works a queue, not a live feed. This is intentional --- it allows one VA to handle far more volume, work across time zones, and maintain quality.

---

## 2. System Overview

```
                          CUSTOMER TOUCHPOINTS
                          ====================

    Shopify Storefront              Support Email              Contact Us Page
    ┌─────────────────┐         ┌────────────────┐         ┌─────────────────┐
    │   AI Chatbot    │         │ support@domain │         │  Contact Form   │
    │   Widget        │         │  (any email    │         │  (embedded on   │
    │   (Layer 1)     │         │   client)      │         │   Shopify page) │
    └────────┬────────┘         └───────┬────────┘         └────────┬────────┘
             │                          │                           │
             │ Escalation               │ Inbound Parse             │ Form POST
             │ (with context)           │ (webhook)                 │
             ▼                          ▼                           ▼
    ┌──────────────────────────────────────────────────────────────────────────┐
    │                                                                          │
    │                    UNIFIED TICKET SYSTEM (Layer 2)                        │
    │                                                                          │
    │  ┌──────────────────────────────────────────────────────────────────┐    │
    │  │                     Ticket Inbox                                  │    │
    │  │                                                                  │    │
    │  │   [Email Tickets]  [Form Tickets]  [AI Escalated Tickets]       │    │
    │  │                                                                  │    │
    │  │   Priority Queue  ──  SLA Tracking  ──  Status Management       │    │
    │  └──────────────────────────────────────────────────────────────────┘    │
    │                              │                                            │
    │                              ▼                                            │
    │  ┌──────────────────────────────────────────────────────────────────┐    │
    │  │                     VA Workspace                                  │    │
    │  │                                                                  │    │
    │  │   Customer Profile  ┃  Conversation Thread  ┃  Actions Panel    │    │
    │  │   ─ Shopify data    ┃  ─ Full thread         ┃  ─ Reply/Note    │    │
    │  │   ─ Order history   ┃  ─ AI conversation     ┃  ─ AI Draft      │    │
    │  │   ─ Return history  ┃  ─ Internal notes      ┃  ─ Shopify Ops   │    │
    │  │   ─ Past tickets    ┃  ─ Attachments         ┃  ─ Canned Resp.  │    │
    │  └──────────────────────────────────────────────────────────────────┘    │
    │                              │                                            │
    │                              ▼                                            │
    │  ┌──────────────────────────────────────────────────────────────────┐    │
    │  │                  Connected Services                               │    │
    │  │                                                                  │    │
    │  │  Shopify Admin API  ┃  Claude AI  ┃  Supabase  ┃  Email (SMTP) │    │
    │  └──────────────────────────────────────────────────────────────────┘    │
    │                                                                          │
    └──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Customer Journey

### 3.1 Journey Map

```
Customer has a question or issue
              │
              ├──── Goes to website ──────────────────────┐
              │                                            │
              │     ┌─────────────────────────────┐       │
              │     │  AI Chatbot opens            │       │
              │     │  (floating widget)           │       │
              │     │                              │       │
              │     │  Preset actions:             │       │
              │     │  - Track my order            │       │
              │     │  - Start a return            │       │
              │     │  - Find products             │       │
              │     │  - Shipping info             │       │
              │     │  - Talk to someone           │       │
              │     └──────────┬───────────────────┘       │
              │                │                           │
              │         AI resolves?                       │
              │           /      \                         │
              │         YES       NO                       │
              │          │         │                        │
              │          │    AI asks for email             │
              │          │    AI escalates with             │
              │          │    full context + next           │
              │          │    steps recommendation          │
              │          │         │                        │
              │       [DONE]      │                        │
              │                   ▼                        │
              │            ┌──────────┐                    │
              │            │  TICKET  │◄───────────────────┘ (Contact Form)
              │            │  CREATED │
              │            └──────────┘
              │                   ▲
              │                   │
              ├──── Sends email ──┘
              │     to support@
              │
              │
     VA works the ticket
     (async, with AI tools)
              │
              ▼
     Customer gets email reply
     Customer responds (email or form)
     Thread continues until resolved
```

### 3.2 Resolution Paths

| Inquiry Type | Layer 1 (AI) | Layer 2 (Ticket) |
|---|---|---|
| "Where is my order?" | AI looks up order via Admin API, provides tracking | Only if order is lost/delayed beyond AI scope |
| "I want to return this" | AI checks eligibility, initiates return | If return is denied but customer disputes |
| "Do you have X in stock?" | AI searches catalog, shows product cards | Never --- AI handles 100% |
| "What's your shipping policy?" | AI checks policies via MCP | Never |
| "I got the wrong item" | AI checks order, may initiate return | Likely escalates --- needs photos, investigation |
| "I want a refund" | AI checks eligibility | Escalates if refund needs manual approval |
| "I'm unhappy with quality" | AI empathizes, offers solutions | Escalates with context for VA to resolve |
| "Custom order request" | AI cannot help | Form or email → ticket |
| "Billing dispute" | AI cannot help | Escalates immediately |
| "Partnership inquiry" | AI cannot help | Form or email → ticket |

---

## 4. Architecture Diagram

### 4.1 Full System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND LAYER                                       │
│                                                                             │
│  Shopify Store          Admin Dashboard (Vercel)         Contact Form       │
│  ┌──────────┐          ┌─────────────────────┐          ┌──────────┐       │
│  │  Widget   │          │  Main Dashboard     │          │ Embedded │       │
│  │  (JS)     │          │  ├─ AI Chatbot Dash │          │ on store │       │
│  │           │          │  ├─ Ticket Inbox    │          │ page     │       │
│  └─────┬─────┘          │  ├─ Insights        │          └─────┬────┘       │
│        │                │  ├─ Knowledge Base  │                │            │
│        │                │  └─ Settings        │                │            │
│        │                └──────────┬──────────┘                │            │
│        │                           │                           │            │
└────────┼───────────────────────────┼───────────────────────────┼────────────┘
         │                           │                           │
         │ HTTPS                     │ HTTPS                     │ HTTPS
         │                           │                           │
┌────────┼───────────────────────────┼───────────────────────────┼────────────┐
│        ▼                           ▼                           ▼            │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                      BACKEND API (Railway)                           │   │
│  │                                                                      │   │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐               │   │
│  │  │ Chat API    │  │ Ticket API   │  │ Admin API     │               │   │
│  │  │ (existing)  │  │ (new)        │  │ (existing +   │               │   │
│  │  │             │  │              │  │  extended)    │               │   │
│  │  └──────┬──────┘  └──────┬───────┘  └──────┬────────┘               │   │
│  │         │                │                  │                        │   │
│  │         ▼                ▼                  ▼                        │   │
│  │  ┌──────────────────────────────────────────────────────────────┐    │   │
│  │  │                   SERVICE LAYER                               │    │   │
│  │  │                                                              │    │   │
│  │  │  AI Service (existing)     Ticket Service (new)              │    │   │
│  │  │  Shopify Auth (existing)   Email Service (new)               │    │   │
│  │  │  Shopify MCP (existing)    Contact Form Service (new)        │    │   │
│  │  │  Shopify Admin (existing)  Customer Profile Service (new)    │    │   │
│  │  │  Conversation (existing)   Notification Service (new)        │    │   │
│  │  │  Knowledge (existing)      SLA Service (new)                 │    │   │
│  │  │  Tool Router (existing)    AI Assistant Service (new)        │    │   │
│  │  └──────────────────────────────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                           │              │              │                    │
└───────────────────────────┼──────────────┼──────────────┼────────────────────┘
                            │              │              │
              ┌─────────────┼──────────────┼──────────────┼─────────────┐
              │             ▼              ▼              ▼             │
              │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐   │
              │  │   Supabase   │  │  Shopify API  │  │  Claude AI │   │
              │  │   (Postgres) │  │  (Admin +     │  │  (Anthropic│   │
              │  │              │  │   Storefront) │  │   API)     │   │
              │  └──────────────┘  └──────────────┘  └────────────┘   │
              │                                                        │
              │  ┌──────────────┐  ┌──────────────┐                   │
              │  │  Email       │  │  File        │                   │
              │  │  Provider    │  │  Storage     │                   │
              │  │  (SendGrid/  │  │  (Supabase   │                   │
              │  │   Resend)    │  │   Storage)   │                   │
              │  └──────────────┘  └──────────────┘                   │
              │           EXTERNAL SERVICES                            │
              └────────────────────────────────────────────────────────┘
```

### 4.2 Data Flow: Ticket Lifecycle

```
  CREATION                    WORKING                      RESOLUTION
  ────────                    ───────                      ──────────

  Email arrives               VA opens ticket              VA sends final reply
       │                           │                            │
       ▼                           ▼                            ▼
  Inbound parse ───┐         Load customer ───┐          Update status ───┐
                   │         from Shopify     │          to 'resolved'    │
  Form submitted ──┤              │           │               │           │
                   │              ▼           │               ▼           │
  AI escalates ────┤         Show unified     │          Send closing     │
                   │         profile:         │          email to         │
                   ▼         - Orders         │          customer         │
              Create         - Past tickets   │               │           │
              ticket         - AI chat log    │               ▼           │
                   │         - Return history │          Auto-close       │
                   │              │           │          after 48h if     │
                   ▼              ▼           │          no response      │
              Assign         AI suggests      │               │           │
              priority       draft reply      │               ▼           │
                   │              │           │          Move to          │
                   ▼              ▼           │          'closed'         │
              Queue in       VA edits,        │               │           │
              inbox          approves,        │               ▼           │
                   │         sends            │          Update           │
                   ▼              │           │          satisfaction     │
              SLA timer          ▼           │          metrics          │
              starts        Execute          │                           │
                            Shopify action   │                           │
                            if needed        │                           │
                            (cancel, refund) │                           │
                                             │                           │
                                             ▼                           ▼
                                        Log everything ──────────► Analytics
```

---

## 5. Ticket System Design

### 5.1 Core Ticket Entity

A ticket represents a **single customer issue** that needs resolution. It has a lifecycle: created, assigned, worked, resolved, closed.

```
Ticket
├── id (uuid)
├── ticket_number (human-readable, auto-incremented: #1001, #1002, ...)
├── source: 'email' | 'form' | 'ai_escalation'
├── status: 'open' | 'pending' | 'resolved' | 'closed'
├── priority: 'low' | 'medium' | 'high' | 'urgent'
├── category: 'order_issue' | 'return_refund' | 'product_inquiry' | 'shipping' |
│             'billing' | 'complaint' | 'custom_request' | 'partnership' | 'other'
├── subject (string)
├── customer_email (string, required --- this is the replyTo address)
├── customer_name (string, nullable)
├── customer_phone (string, nullable)
├── shopify_customer_id (string, nullable --- resolved on creation if possible)
├── assigned_to (uuid, nullable --- FK to agents table)
├── tags (text[], for flexible categorization)
├── conversation_id (uuid, nullable --- FK to conversations table, for AI escalations)
├── order_id (string, nullable --- Shopify order GID if ticket relates to an order)
├── metadata (jsonb --- flexible storage for source-specific data)
├── first_response_at (timestamptz, nullable --- tracks SLA)
├── resolved_at (timestamptz, nullable)
├── closed_at (timestamptz, nullable)
├── sla_deadline (timestamptz, nullable --- calculated from priority)
├── sla_breached (boolean, default false)
├── created_at (timestamptz)
├── updated_at (timestamptz)
```

### 5.2 Ticket Statuses

```
    ┌──────┐     assign/     ┌─────────┐    waiting on     ┌─────────┐
    │ OPEN │────────────────►│ PENDING │◄──────────────────│RESOLVED │
    │      │     reply       │         │    customer       │         │
    └──────┘                 └────┬────┘    responds        └────┬────┘
                                  │                              │
                                  │  VA sends                    │  Auto-close
                                  │  final reply                 │  after 48h
                                  │                              │  no response
                                  ▼                              │
                             ┌─────────┐                         │
                             │RESOLVED │─────────────────────────┘
                             │         │
                             └────┬────┘
                                  │
                                  │  48h auto-close or
                                  │  manual close
                                  ▼
                             ┌─────────┐
                             │ CLOSED  │
                             │         │
                             └─────────┘
```

| Status | Meaning | Visible to VA |
|---|---|---|
| `open` | New ticket, not yet responded to | Yes, highlighted |
| `pending` | VA has replied, waiting on customer | Yes, dimmed |
| `resolved` | VA marked as resolved, waiting for auto-close window | Yes, in resolved tab |
| `closed` | Fully done, archived | Only in search/filters |

### 5.3 Priority & SLA

| Priority | First Response SLA | Resolution Target | Use Case |
|---|---|---|---|
| `urgent` | 2 hours | 4 hours | Order lost in transit, billing error, angry customer |
| `high` | 4 hours | 12 hours | Return dispute, wrong item received |
| `medium` | 8 hours | 24 hours | General order questions, product issues |
| `low` | 24 hours | 48 hours | Partnership inquiries, feedback, feature requests |

**Auto-priority assignment:**
- AI escalation with `priority: 'urgent'` or `priority: 'high'` → maps directly
- AI escalation with detected frustration → bumped to `high`
- Email tickets → default `medium`, unless subject contains trigger words (urgent, ASAP, disappointed, refund, scam, charged)
- Form tickets → based on category selected by customer

### 5.4 Ticket Messages (Thread)

Each ticket has a thread of messages, similar to an email chain:

```
Ticket Message
├── id (uuid)
├── ticket_id (FK → tickets)
├── sender_type: 'customer' | 'agent' | 'system' | 'ai_draft'
├── sender_name (string)
├── sender_email (string)
├── content (text --- the message body)
├── content_html (text, nullable --- rich HTML version for emails)
├── is_internal_note (boolean --- if true, not visible to customer)
├── attachments (jsonb[] --- file URLs, names, sizes)
├── email_message_id (string, nullable --- for email threading)
├── ai_generated (boolean --- whether this was drafted by AI)
├── metadata (jsonb)
├── created_at (timestamptz)
```

**Thread display order**: Chronological (oldest first), with internal notes visually distinct (highlighted background, "[Internal Note]" badge).

### 5.5 Ticket Lifecycle Events (Audit Log)

Every state change is logged for accountability and analytics:

```
Ticket Event
├── id (uuid)
├── ticket_id (FK → tickets)
├── event_type: 'created' | 'status_changed' | 'priority_changed' | 'assigned' |
│               'unassigned' | 'tagged' | 'untagged' | 'merged' | 'note_added' |
│               'customer_replied' | 'agent_replied' | 'sla_breached' |
│               'shopify_action' | 'ai_draft_generated' | 'reopened'
├── actor: 'system' | 'agent' | 'customer' | 'ai'
├── actor_id (string, nullable)
├── old_value (text, nullable)
├── new_value (text, nullable)
├── metadata (jsonb)
├── created_at (timestamptz)
```

---

## 6. Three Ticket Sources

### 6.1 Source: Email

**How it works:**

1. Company has a support email: `support@yourdomain.com`
2. An email service provider (Resend, SendGrid, or Postmark) is configured to receive inbound emails at this address
3. When an email arrives, the provider sends a webhook (HTTP POST) to the backend
4. Backend parses the email: sender, subject, body (plain text + HTML), attachments, headers
5. Backend checks if this is a **reply to an existing ticket** (via `In-Reply-To` / `References` email headers, or a ticket reference in the subject line like `[#1042]`)
6. If reply → append as new message to existing ticket
7. If new → create new ticket with source `email`

**Webhook payload processing:**

```
Inbound Email Webhook
        │
        ▼
  Parse sender email, name
  Parse subject line
  Parse body (prefer plain text, fallback HTML→text)
  Parse attachments (store in Supabase Storage, save URLs)
        │
        ▼
  Check: does subject contain [#NNNN]?
  Check: does In-Reply-To match a known email_message_id?
    │               │
   YES              NO
    │               │
    ▼               ▼
  Find ticket    Create new ticket
  by number      ├── subject → ticket subject
    │            ├── body → first message
    ▼            ├── sender → customer_email, customer_name
  Append         ├── attachments → message attachments
  message        ├── source: 'email'
  to thread      ├── auto-detect priority from keywords
    │            ├── auto-detect category from subject/body
    ▼            └── resolve Shopify customer ID if email matches
  Update
  ticket status
  (reopen if
  resolved/closed)
```

**Email replies from VA:**
- VA composes reply in ticket inbox
- Backend sends email via provider API (Resend/SendGrid)
- Email includes ticket reference in subject: `Re: Original Subject [#1042]`
- Sets `In-Reply-To` and `References` headers for proper threading in customer's email client
- Stores sent email as message in ticket thread

### 6.2 Source: Contact Form

**How it works:**

1. A contact form is embedded on the Shopify store's "Contact Us" page
2. The form is a lightweight HTML/JS snippet (similar to the chat widget embed approach)
3. Customer fills out: name, email, category (dropdown), order number (optional), message
4. Form submits to backend API endpoint `POST /api/tickets/form`
5. Backend creates a ticket with source `form`
6. Customer sees a confirmation message with their ticket number
7. Customer receives a confirmation email: "We received your request (#1042). We'll reply within [SLA time]."

**Form fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| name | text | Yes | Customer's name |
| email | text | Yes | Reply-to address |
| category | select | Yes | Dropdown: Order Issue, Return/Refund, Product Question, Shipping, Billing, Other |
| order_number | text | No | If related to a specific order |
| subject | text | Yes | Brief description |
| message | textarea | Yes | Detailed description |
| attachments | file[] | No | Up to 3 files, 5MB each (images, PDFs) |

**Embed approach:**
- Simple `<form>` tag with a few fields, styled to match the store theme
- Can be a Shopify Liquid snippet or a small JS widget (like the chat widget)
- Includes honeypot field + rate limiting for spam prevention
- reCAPTCHA or Turnstile optional but recommended

**Priority mapping from category:**

| Category | Default Priority |
|---|---|
| Order Issue | medium |
| Return/Refund | medium |
| Product Question | low |
| Shipping | medium |
| Billing | high |
| Other | low |

### 6.3 Source: AI Escalation

**How it works:**

This is the most context-rich ticket source. When the AI chatbot determines it cannot resolve an issue, it:

1. Asks the customer for their email address (required for the ticket system to reply)
2. Calls the `escalate_to_human` tool with reason, priority, and context
3. Backend creates a ticket with source `ai_escalation`
4. The ticket includes the **full AI conversation** as context
5. The AI generates a **recommended next steps** summary for the VA
6. Customer sees a message in the chat: "I've created a support ticket for you. Our team will reach out to [email] within [SLA time]."
7. Customer receives a confirmation email with ticket number

**Escalation data package (what the VA sees):**

```
AI Escalation Context
├── conversation_id (links to full AI chat in conversations table)
├── conversation_summary (AI-generated 2-3 sentence summary)
├── customer_email (collected during chat)
├── customer_name (if provided)
├── escalation_reason (from AI tool call)
├── priority (from AI assessment)
├── ai_recommended_actions (string[] --- what the AI suggests the VA should do)
├── tools_used (what the AI already tried)
├── customer_sentiment (detected mood: frustrated, confused, neutral, etc.)
├── page_url (where the customer was browsing)
├── cart_id (if they had items in cart)
├── order_id (if discussion involved a specific order)
```

**Conversation display in ticket:**
- The full AI conversation is shown in a collapsible section at the top of the ticket
- Formatted cleanly: user messages on one side, AI responses on the other
- Tool calls shown as compact badges (e.g., "Looked up order #1234", "Searched products for 'red dress'")
- This gives the VA full context without having to re-ask the customer anything

**What the AI should summarize for the VA (recommended next steps):**

The AI generates a concise internal note when escalating, such as:

> **Summary:** Customer ordered a red silk dress (Order #1234) two weeks ago. Item arrived with a stain. Customer wants a replacement, not a refund. Return eligibility check passed. Customer provided photos (not attached --- request photos via email).
>
> **Recommended next steps:**
> 1. Request photos of the damaged item via email
> 2. If damage confirmed, initiate a replacement order
> 3. Provide a prepaid return label for the damaged item
> 4. Consider offering a 10% discount code for the inconvenience

---

## 7. Unified Ticket Inbox

### 7.1 Inbox Layout

The ticket inbox is the VA's primary workspace. It is designed for efficiency --- minimize clicks, maximize context.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  TICKET INBOX                                              [Search] [Filter] │
│                                                                              │
│  ┌──────────────┐  ┌────────────────────────────────────────────────────┐   │
│  │   SIDEBAR     │  │                                                    │   │
│  │               │  │  TICKET LIST                                       │   │
│  │  Views:       │  │                                                    │   │
│  │  ┌──────────┐│  │  ┌────────────────────────────────────────────┐   │   │
│  │  │ All Open ││  │  │ ★ #1047  Return request - wrong size       │   │   │
│  │  │ (12)     ││  │  │   sarah@email.com  ·  AI Escalation       │   │   │
│  │  └──────────┘│  │  │   HIGH  ·  2h ago  ·  SLA: 1h 30m left   │   │   │
│  │  ┌──────────┐│  │  └────────────────────────────────────────────┘   │   │
│  │  │Unassigned││  │  ┌────────────────────────────────────────────┐   │   │
│  │  │ (4)      ││  │  │   #1046  Where is my package?              │   │   │
│  │  └──────────┘│  │  │   mike@email.com  ·  Email                 │   │   │
│  │  ┌──────────┐│  │  │   MEDIUM  ·  5h ago  ·  SLA: 3h left      │   │   │
│  │  │My Tickets││  │  └────────────────────────────────────────────┘   │   │
│  │  │ (8)      ││  │  ┌────────────────────────────────────────────┐   │   │
│  │  └──────────┘│  │  │   #1045  Partnership inquiry               │   │   │
│  │  ┌──────────┐│  │  │   brand@company.com  ·  Form               │   │   │
│  │  │ Pending  ││  │  │   LOW  ·  1d ago  ·  SLA: OK               │   │   │
│  │  │ (6)      ││  │  └────────────────────────────────────────────┘   │   │
│  │  └──────────┘│  │                                                    │   │
│  │  ┌──────────┐│  │  ... more tickets ...                              │   │
│  │  │ Resolved ││  │                                                    │   │
│  │  │ (15)     ││  │                                                    │   │
│  │  └──────────┘│  │                                                    │   │
│  │               │  │                                                    │   │
│  │  ───────────  │  └────────────────────────────────────────────────────┘   │
│  │               │                                                           │
│  │  Sources:     │                                                           │
│  │  ○ Email (5)  │                                                           │
│  │  ○ Form (3)   │                                                           │
│  │  ○ AI Esc (4) │                                                           │
│  │               │                                                           │
│  │  ───────────  │                                                           │
│  │               │                                                           │
│  │  Priority:    │                                                           │
│  │  ● Urgent (1) │                                                           │
│  │  ● High (3)   │                                                           │
│  │  ● Medium (5) │                                                           │
│  │  ● Low (3)    │                                                           │
│  │               │                                                           │
│  │  ───────────  │                                                           │
│  │               │                                                           │
│  │  Category:    │                                                           │
│  │  ○ All        │                                                           │
│  │  ○ Orders     │                                                           │
│  │  ○ Returns    │                                                           │
│  │  ○ Billing    │                                                           │
│  │  ○ ...        │                                                           │
│  └──────────────┘                                                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Ticket List Item

Each ticket in the list shows at a glance:

```
┌─────────────────────────────────────────────────────────────────┐
│  ★ #1047  Return request - wrong size received                  │
│                                                                 │
│  sarah.j@email.com  ·  AI Escalation  ·  Order #5678           │
│                                                                 │
│  HIGH  ·  Assigned to: You  ·  2h ago  ·  SLA: 1h 30m left    │
│                                                                 │
│  Tags: [return] [wrong-item] [needs-photos]                    │
│                                                                 │
│  Last: "I've escalated this to our team..."  (AI, 2h ago)      │
└─────────────────────────────────────────────────────────────────┘
```

- **Star** = unread / needs attention
- **Ticket number** = human-readable sequential ID
- **Subject** = from email subject, form subject, or AI-generated
- **Source badge** = Email / Form / AI Escalation (color-coded)
- **Priority pill** = Urgent (red), High (orange), Medium (blue), Low (gray)
- **SLA indicator** = Time remaining, turns red when breached
- **Tags** = Quick visual categorization
- **Last message preview** = First 100 chars of most recent message

### 7.3 Ticket Detail View

When a VA clicks a ticket, they see the full workspace:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ← Back to Inbox          #1047  Return request - wrong size received       │
│                                                                              │
│  Status: [OPEN ▼]   Priority: [HIGH ▼]   Assign: [You ▼]                   │
│  Tags: [return] [wrong-item] [+add tag]                                     │
│                                                                              │
│  ┌─────────────────────────────────┐  ┌──────────────────────────────────┐  │
│  │  CONVERSATION THREAD            │  │  CUSTOMER SIDEBAR               │  │
│  │                                 │  │                                  │  │
│  │  ┌───────────────────────────┐  │  │  Sarah Johnson                  │  │
│  │  │ AI CONVERSATION CONTEXT   │  │  │  sarah.j@email.com              │  │
│  │  │ (Collapsible)             │  │  │  +1 555-0123                    │  │
│  │  │                           │  │  │  Customer since: Jan 2025       │  │
│  │  │  Customer: I ordered a    │  │  │                                  │  │
│  │  │  red dress and got the    │  │  │  ─────────────────────────────  │  │
│  │  │  wrong size...            │  │  │                                  │  │
│  │  │                           │  │  │  ORDERS                         │  │
│  │  │  AI: I understand how     │  │  │  ┌────────────────────────────┐│  │
│  │  │  frustrating that must    │  │  │  │ #5678  ·  $89.00          ││  │
│  │  │  be. Let me check your    │  │  │  │ Red Silk Dress (M)        ││  │
│  │  │  order...                 │  │  │  │ Delivered Mar 5            ││  │
│  │  │                           │  │  │  │ [View in Shopify]         ││  │
│  │  │  [Looked up Order #5678]  │  │  │  └────────────────────────────┘│  │
│  │  │  [Checked Return Elig.]   │  │  │  ┌────────────────────────────┐│  │
│  │  │                           │  │  │  │ #5432  ·  $45.00          ││  │
│  │  │  AI recommended:          │  │  │  │ Blue Scarf                ││  │
│  │  │  1. Request photos        │  │  │  │ Delivered Feb 20           ││  │
│  │  │  2. Initiate replacement  │  │  │  └────────────────────────────┘│  │
│  │  │  3. Offer 10% discount    │  │  │                                  │  │
│  │  └───────────────────────────┘  │  │  ─────────────────────────────  │  │
│  │                                 │  │                                  │  │
│  │  ┌───────────────────────────┐  │  │  PAST TICKETS                   │  │
│  │  │ System · Mar 7, 2:15 PM   │  │  │  #1023 (closed) - Size guide   │  │
│  │  │ Ticket created from AI    │  │  │  question · Resolved Mar 1     │  │
│  │  │ escalation                │  │  │                                  │  │
│  │  └───────────────────────────┘  │  │  ─────────────────────────────  │  │
│  │                                 │  │                                  │  │
│  │  ┌───────────────────────────┐  │  │  RETURN HISTORY                 │  │
│  │  │ Internal Note · You       │  │  │  No previous returns            │  │
│  │  │ Mar 7, 2:20 PM            │  │  │                                  │  │
│  │  │                           │  │  │  ─────────────────────────────  │  │
│  │  │ Reviewed AI conversation. │  │  │                                  │  │
│  │  │ Customer seems patient.   │  │  │  QUICK ACTIONS                  │  │
│  │  │ Will request photos first.│  │  │  ┌────────────────────────────┐│  │
│  │  └───────────────────────────┘  │  │  │ Cancel Order              ││  │
│  │                                 │  │  │ Issue Refund              ││  │
│  │  ┌───────────────────────────┐  │  │  │ Create Return             ││  │
│  │  │ You → Customer            │  │  │  │ Create Discount           ││  │
│  │  │ Mar 7, 2:25 PM            │  │  │  │ Resend Confirmation       ││  │
│  │  │                           │  │  │  └────────────────────────────┘│  │
│  │  │ Hi Sarah,                 │  │  │                                  │  │
│  │  │                           │  │  │  ─────────────────────────────  │  │
│  │  │ I'm sorry about the       │  │  │                                  │  │
│  │  │ sizing issue. Could you   │  │  │  AI TOOLS                       │  │
│  │  │ send a photo of...        │  │  │  [Draft Reply]                  │  │
│  │  └───────────────────────────┘  │  │  [Summarize Thread]             │  │
│  │                                 │  │  [Suggest Next Steps]           │  │
│  │                                 │  │  [Search Knowledge Base]        │  │
│  └─────────────────────────────────┘  └──────────────────────────────────┘  │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  REPLY COMPOSER                                                      │   │
│  │                                                                      │   │
│  │  [Reply] [Internal Note]                              [AI Draft ▼]  │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐   │   │
│  │  │                                                              │   │   │
│  │  │  Hi Sarah,                                                   │   │   │
│  │  │                                                              │   │   │
│  │  │  (cursor here)                                               │   │   │
│  │  │                                                              │   │   │
│  │  └──────────────────────────────────────────────────────────────┘   │   │
│  │                                                                      │   │
│  │  [Attach File]  [Canned Response ▼]  [Insert KB Article ▼]          │   │
│  │                                                                      │   │
│  │                                    [Send & Set Pending]  [Send ▼]   │   │
│  │                                                                      │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 7.4 Inbox Features

**Sorting:**
- Default: SLA urgency (most urgent first, then oldest first)
- Options: Newest first, Oldest first, Priority, Last updated, Ticket number

**Search:**
- Full-text search across ticket subject, messages, customer email/name
- Exact match on ticket number (#1047)
- Exact match on order number

**Bulk Actions:**
- Select multiple tickets → Assign, Change priority, Add tags, Close, Merge

**Keyboard Shortcuts:**
- `j/k` = Navigate up/down in ticket list
- `o` or `Enter` = Open ticket
- `r` = Reply
- `n` = Internal note
- `a` = Assign
- `p` = Change priority
- `Esc` = Back to list
- `Ctrl+Enter` = Send reply

**Notifications:**
- Browser notification when new ticket arrives
- Badge count on inbox tab
- SLA breach alerts (ticket turns red in list)
- Sound notification option (configurable)

---

## 8. AI Agent Tools for VAs

The VA has AI tools available directly in the ticket workspace. These are powered by Claude, using the ticket context and Shopify data.

### 8.1 AI Draft Reply

The VA clicks "AI Draft" and the system:

1. Sends to Claude: the full ticket thread, customer profile, order history, KB articles, and the VA's instructions (if any)
2. Claude generates a professional reply draft
3. Draft appears in the composer as editable text
4. VA reviews, edits if needed, then sends

**AI Draft prompt template:**

```
You are drafting a customer support email reply for a VA.

Context:
- Brand voice: {brand_voice from ai_config}
- Ticket subject: {subject}
- Ticket category: {category}
- Customer name: {name}
- Order details: {order data if available}

Conversation thread:
{all messages in thread}

{If AI escalation: "AI chatbot conversation before escalation:" + conversation log}

Relevant knowledge base articles:
{matched KB docs}

Instructions:
- Write a professional, warm, helpful reply
- Address the customer by name
- Reference specific order/product details when relevant
- Propose a clear solution or next step
- Keep it concise (under 200 words unless complexity requires more)
- Do NOT make promises you can't keep (no "we'll refund immediately" unless confirmed)
- Sign off with the brand name
```

### 8.2 Summarize Thread

For long ticket threads (especially email chains), the VA can click "Summarize" to get:

- 2-3 sentence summary of the issue
- What the customer wants
- What has been done so far
- What remains unresolved

### 8.3 Suggest Next Steps

Based on the ticket context, AI suggests actionable next steps:

- "Customer needs a return label. Use the 'Create Return' action."
- "Order was delivered 3 days ago. Customer claims non-receipt. Check tracking details."
- "Customer is asking for a discount. Consider offering 10% off next order."

### 8.4 Search Knowledge Base

Contextual KB search from within the ticket. VA can:
- Search by keyword
- AI auto-suggests relevant articles based on ticket content
- Insert KB article snippets directly into reply composer

### 8.5 Sentiment Indicator

Displayed as a small badge on the ticket:
- Neutral (gray)
- Confused (yellow)
- Frustrated (orange)
- Angry (red)
- Happy (green)

Calculated from the latest customer message using simple heuristics or Claude analysis. Helps VAs prioritize and adjust tone.

---

## 9. Shopify Integration & Actions

### 9.1 Customer Profile (Read)

When a ticket is opened, the system resolves the customer's Shopify profile using their email:

**Data pulled from Shopify Admin API:**

```
Customer Profile
├── Name, email, phone
├── Customer since (created_at)
├── Total orders count
├── Total spend
├── Tags (VIP, wholesale, etc.)
├── Default address
├── Marketing consent status
├── Account status (enabled/disabled)
├── Notes (internal Shopify notes)
```

**GraphQL query: `customers(query: "email:{email}")`**

### 9.2 Order History (Read)

All orders for the customer, shown in the sidebar:

```
Order
├── Order number, total price, currency
├── Financial status (paid, refunded, partially_refunded)
├── Fulfillment status (fulfilled, unfulfilled, partial)
├── Line items (product name, variant, quantity, price)
├── Tracking number and URL
├── Shipping address
├── Created at, fulfilled at
├── Discount codes applied
├── Notes
```

**GraphQL query: `orders(query: "email:{email}")`**

### 9.3 Available Actions (Write)

These are actions the VA can execute directly from the ticket workspace:

| Action | Shopify API | Scope Required | Confirmation |
|---|---|---|---|
| Cancel Order | `orderCancel` mutation | `write_orders` | Yes, with reason |
| Issue Refund | `refundCreate` mutation | `write_orders` | Yes, with amount + reason |
| Create Return | `returnCreate` mutation | `write_returns` | Yes, with line items |
| Create Discount Code | `discountCodeBasicCreate` mutation | `write_discounts` | Yes, with amount/% and expiry |
| Edit Order Notes | `orderUpdate` mutation | `write_orders` | No |
| Add Customer Tags | `customerUpdate` mutation | `write_customers` | No |
| Resend Order Confirmation | `orderSendEmail` mutation | `write_orders` | No |

**Action execution flow:**

```
VA clicks "Issue Refund"
        │
        ▼
  Confirmation modal:
  ┌─────────────────────────────┐
  │  Issue Refund for #5678     │
  │                             │
  │  Amount: [$89.00        ]   │
  │  Reason: [Wrong item   ▼]  │
  │  Notify customer: [✓]      │
  │                             │
  │  [Cancel]  [Issue Refund]   │
  └─────────────────────────────┘
        │
        ▼
  Backend calls Shopify Admin API
        │
        ▼
  Log event in ticket audit trail:
  "Refund of $89.00 issued for Order #5678 (Reason: Wrong item)"
        │
        ▼
  Auto-add internal note to ticket thread
  Update ticket (tag: refund-issued)
```

**Note on new scopes needed:**
The existing app has `read_orders`, `read_customers`, `read_products`, etc. For write actions, these additional scopes will be needed:
- `write_orders` (cancel, refund, edit notes, resend confirmation)
- `write_customers` (update tags, notes)
- `write_discounts` (already have this)
- `write_returns` (already have this)

---

## 10. Dashboard Architecture

### 10.1 Navigation Structure

The admin dashboard is restructured from the current single-purpose AI chatbot dashboard into a multi-section support platform:

```
┌──────────────────────────────────────────────────────────────┐
│  SUPPORT DASHBOARD                           [VA Name ▼]     │
│                                                              │
│  ┌──────────────┐                                           │
│  │  NAVIGATION   │                                           │
│  │               │                                           │
│  │  Overview     │  ← Main dashboard (KPIs, quick links)     │
│  │               │                                           │
│  │  ───────────  │                                           │
│  │               │                                           │
│  │  Ticket Inbox │  ← Unified ticket workspace               │
│  │    All Open   │                                           │
│  │    My Tickets │                                           │
│  │    Unassigned │                                           │
│  │    Pending    │                                           │
│  │    Resolved   │                                           │
│  │               │                                           │
│  │  ───────────  │                                           │
│  │               │                                           │
│  │  AI Chatbot   │  ← Existing dashboard (redirects here)    │
│  │    Convos     │    Conversations, playground, AI config    │
│  │    Playground  │                                           │
│  │    AI Config  │                                           │
│  │    Capabilities│                                           │
│  │               │                                           │
│  │  ───────────  │                                           │
│  │               │                                           │
│  │  Knowledge    │  ← Shared KB (used by both AI and VAs)    │
│  │  Base         │                                           │
│  │               │                                           │
│  │  Insights     │  ← Analytics for everything                │
│  │               │                                           │
│  │  Settings     │  ← Email, form, SLA, canned responses,    │
│  │               │    team, integrations                      │
│  └──────────────┘                                           │
└──────────────────────────────────────────────────────────────┘
```

### 10.2 Overview Page (Main Dashboard)

The landing page after login. High-level snapshot of the entire support operation.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│  OVERVIEW                                                  Today ▼      │
│                                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐ │
│  │ Open     │  │ Urgent/  │  │ Avg First│  │ AI Auto- │  │ SLA      │ │
│  │ Tickets  │  │ High     │  │ Response │  │ Resolved │  │ Compliance│ │
│  │          │  │          │  │          │  │          │  │          │ │
│  │    12    │  │    4     │  │  1.5h    │  │  78%     │  │  94%     │ │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘ │
│                                                                          │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │  TICKET QUEUE SUMMARY        │  │  AI CHATBOT STATUS               │ │
│  │                              │  │                                  │ │
│  │  Unassigned:  4 (1 urgent)  │  │  Active chats today:  45        │ │
│  │  Your open:   8             │  │  Auto-resolved:       35 (78%)  │ │
│  │  Pending:     6             │  │  Escalated:           10 (22%)  │ │
│  │  Breaching:   1 (!)        │  │  Avg resolution time: 2.3 min   │ │
│  │                              │  │                                  │ │
│  │  [Go to Inbox →]            │  │  [Go to AI Dashboard →]         │ │
│  └──────────────────────────────┘  └──────────────────────────────────┘ │
│                                                                          │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │  TICKETS BY SOURCE (7 days)  │  │  RECENT ACTIVITY                 │ │
│  │                              │  │                                  │ │
│  │  Email:         ████░░  23  │  │  #1047 - Assigned to you (2m)   │ │
│  │  Form:          ██░░░░  12  │  │  #1046 - Customer replied (15m) │ │
│  │  AI Escalation: █████░  31  │  │  #1044 - Resolved (1h)          │ │
│  │                              │  │  #1043 - Refund issued (2h)     │ │
│  │  Total: 66                   │  │  #1041 - SLA breached (3h)      │ │
│  └──────────────────────────────┘  └──────────────────────────────────┘ │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐│
│  │  SATISFACTION TREND (30 days)                                        ││
│  │                                                                      ││
│  │  [Line chart: AI satisfaction + Ticket satisfaction over time]       ││
│  └──────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
```

### 10.3 AI Chatbot Dashboard (Existing, Restructured)

The current admin dashboard pages are preserved but nested under the "AI Chatbot" section. No functionality changes --- just reorganized as a sub-section of the larger support dashboard.

**Pages (carried over):**
- **Conversations** --- List of all AI chatbot conversations with search/filter
- **Conversation Detail** --- Full message thread with token/latency metrics
- **Playground** --- Live widget testing with debug panel
- **AI Config** --- System prompt, brand voice, greeting, presets
- **Capabilities** --- Available tools documentation

### 10.4 Knowledge Base Page

Enhanced from the current implementation. Now serves both AI (for context injection) and VAs (for reference and copy-paste into replies).

```
┌──────────────────────────────────────────────────────────────────────────┐
│  KNOWLEDGE BASE                                    [+ New Article]       │
│                                                                          │
│  [Search articles...]                                                    │
│                                                                          │
│  Categories:  [All]  [Shipping]  [Returns]  [Products]  [Policies]      │
│               [FAQ]  [Internal Procedures]  [Troubleshooting]           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Shipping Policy                                     [Edit] [▼]  │   │
│  │  Category: Shipping  ·  Priority: 10  ·  Enabled: ✓            │   │
│  │                                                                  │   │
│  │  Standard shipping: 5-7 business days, free over $75.           │   │
│  │  Express shipping: 2-3 business days, $12.99.                   │   │
│  │  International: 10-15 business days, rates at checkout.         │   │
│  │  ...                                                             │   │
│  │                                                                  │   │
│  │  Used by AI: 142 times  ·  Last updated: Mar 5, 2026            │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  Return & Exchange Policy                            [Edit] [▼]  │   │
│  │  Category: Returns  ·  Priority: 9  ·  Enabled: ✓             │   │
│  │  ...                                                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ... more articles ...                                                   │
└──────────────────────────────────────────────────────────────────────────┘
```

**New features over existing KB:**
- Usage tracking (how often AI references each article)
- "Internal Procedures" category (visible only to VAs, not to AI)
- Rich text editor (markdown with preview)
- Article versioning (see edit history)
- "Copy to clipboard" button for VAs to paste into replies

### 10.5 Settings Page

```
Settings
├── General
│   ├── Store name, support email display name
│   ├── Business hours (for SLA calculations)
│   └── Timezone
│
├── Email
│   ├── Inbound email address configuration
│   ├── Email provider settings (API key, domain)
│   ├── Email signature template
│   └── Auto-reply template (for new tickets)
│
├── Contact Form
│   ├── Enable/disable
│   ├── Custom fields configuration
│   ├── Spam protection settings
│   ├── Embed code generator
│   └── Confirmation message text
│
├── SLA Rules
│   ├── Response time targets per priority
│   ├── Business hours vs calendar hours
│   ├── Breach notification settings
│   └── Auto-escalation rules
│
├── Canned Responses
│   ├── List of templates (name, category, content)
│   ├── Create/edit/delete
│   ├── Variable support: {customer_name}, {order_number}, {ticket_number}
│   └── Categories: Greetings, Shipping, Returns, Apologies, Closings
│
├── Tags
│   ├── Manage tag list
│   └── Tag colors
│
├── Team
│   ├── VA accounts (name, email, role)
│   ├── Role permissions (admin vs agent)
│   └── Assignment rules (round-robin, manual)
│
└── Integrations
    ├── Shopify connection status
    ├── Email provider status
    ├── AI (Claude) configuration
    └── Webhook URLs
```

---

## 11. Database Schema

### 11.1 New Tables

These tables are added to the existing Supabase database alongside the current tables (conversations, messages, knowledge_documents, ai_config, return_requests).

#### tickets

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| ticket_number | serial | Unique, auto-increment, starts at 1001 |
| source | text | NOT NULL, check in ('email', 'form', 'ai_escalation') |
| status | text | NOT NULL, default 'open', check in ('open', 'pending', 'resolved', 'closed') |
| priority | text | NOT NULL, default 'medium', check in ('low', 'medium', 'high', 'urgent') |
| category | text | nullable, check in ('order_issue', 'return_refund', 'product_inquiry', 'shipping', 'billing', 'complaint', 'custom_request', 'partnership', 'other') |
| subject | text | NOT NULL |
| customer_email | text | NOT NULL |
| customer_name | text | nullable |
| customer_phone | text | nullable |
| shopify_customer_id | text | nullable |
| assigned_to | uuid | nullable, FK → agents.id |
| tags | text[] | default '{}' |
| conversation_id | uuid | nullable, FK → conversations.id (for AI escalations) |
| order_id | text | nullable (Shopify order GID) |
| metadata | jsonb | nullable |
| first_response_at | timestamptz | nullable |
| resolved_at | timestamptz | nullable |
| closed_at | timestamptz | nullable |
| sla_deadline | timestamptz | nullable |
| sla_breached | boolean | default false |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

**Indexes:** status, priority, assigned_to, customer_email, sla_deadline, (status, priority, sla_deadline) composite, ticket_number, conversation_id

#### ticket_messages

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| ticket_id | uuid | NOT NULL, FK → tickets.id ON DELETE CASCADE |
| sender_type | text | NOT NULL, check in ('customer', 'agent', 'system', 'ai_draft') |
| sender_name | text | nullable |
| sender_email | text | nullable |
| content | text | NOT NULL |
| content_html | text | nullable |
| is_internal_note | boolean | default false |
| attachments | jsonb | default '[]' |
| email_message_id | text | nullable, unique (for email threading) |
| ai_generated | boolean | default false |
| metadata | jsonb | nullable |
| created_at | timestamptz | default now() |

**Indexes:** (ticket_id, created_at) composite, email_message_id

#### ticket_events

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| ticket_id | uuid | NOT NULL, FK → tickets.id ON DELETE CASCADE |
| event_type | text | NOT NULL |
| actor | text | NOT NULL, check in ('system', 'agent', 'customer', 'ai') |
| actor_id | text | nullable |
| old_value | text | nullable |
| new_value | text | nullable |
| metadata | jsonb | nullable |
| created_at | timestamptz | default now() |

**Indexes:** (ticket_id, created_at) composite, event_type

#### agents

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| name | text | NOT NULL |
| email | text | NOT NULL, unique |
| password_hash | text | NOT NULL |
| role | text | NOT NULL, default 'agent', check in ('admin', 'agent') |
| is_active | boolean | default true |
| avatar_url | text | nullable |
| notification_preferences | jsonb | default '{}' |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

**Indexes:** email (unique), role

#### canned_responses

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| name | text | NOT NULL |
| category | text | NOT NULL |
| content | text | NOT NULL |
| variables | text[] | default '{}' (list of variable names used) |
| usage_count | integer | default 0 |
| created_by | uuid | nullable, FK → agents.id |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

#### email_settings

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| provider | text | NOT NULL (e.g., 'resend', 'sendgrid') |
| api_key_encrypted | text | NOT NULL |
| from_email | text | NOT NULL |
| from_name | text | NOT NULL |
| reply_to | text | nullable |
| inbound_webhook_secret | text | nullable |
| signature_html | text | nullable |
| auto_reply_enabled | boolean | default true |
| auto_reply_template | text | nullable |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

#### sla_rules

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, default gen_random_uuid() |
| priority | text | NOT NULL, unique |
| first_response_minutes | integer | NOT NULL |
| resolution_target_minutes | integer | NOT NULL |
| business_hours_only | boolean | default true |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

**Default seed data:**

| Priority | First Response (min) | Resolution Target (min) |
|---|---|---|
| urgent | 120 | 240 |
| high | 240 | 720 |
| medium | 480 | 1440 |
| low | 1440 | 2880 |

### 11.2 Updated Existing Tables

#### conversations (add column)

| Column | Type | Notes |
|---|---|---|
| escalated_ticket_id | uuid, nullable | FK → tickets.id. Set when AI escalates. Bidirectional link. |

#### knowledge_documents (add columns)

| Column | Type | Notes |
|---|---|---|
| visibility | text, default 'all' | 'all' = AI + VA, 'internal' = VA only, 'ai_only' = AI only |
| usage_count | integer, default 0 | How often AI/VA has used this article |
| last_used_at | timestamptz, nullable | When it was last referenced |

### 11.3 Entity Relationship Diagram

```
                     ┌──────────────┐
                     │    agents    │
                     │──────────────│
                     │ id (PK)      │
                     │ name         │
                     │ email        │
                     │ role         │
                     └──────┬───────┘
                            │ 1
                            │
                            │ assigned_to
                            │
                     ┌──────┴───────┐         ┌──────────────────┐
                     │   tickets    │    1:1   │  conversations   │
                     │──────────────│─────────►│  (existing)      │
                     │ id (PK)      │ conv_id  │──────────────────│
                     │ ticket_number│         │ id (PK)          │
                     │ source       │◄─────────│ escalated_ticket │
                     │ status       │         │ ...              │
                     │ priority     │         └──────────────────┘
                     │ subject      │
                     │ customer_*   │
                     │ ...          │
                     └──┬───────┬───┘
                        │       │
              ┌─────────┘       └──────────┐
              │ 1:N                        │ 1:N
              ▼                            ▼
   ┌──────────────────┐        ┌──────────────────┐
   │ ticket_messages  │        │  ticket_events   │
   │──────────────────│        │──────────────────│
   │ id (PK)          │        │ id (PK)          │
   │ ticket_id (FK)   │        │ ticket_id (FK)   │
   │ sender_type      │        │ event_type       │
   │ content          │        │ actor            │
   │ is_internal_note │        │ old_value        │
   │ attachments      │        │ new_value        │
   │ ...              │        │ ...              │
   └──────────────────┘        └──────────────────┘

   ┌──────────────────┐        ┌──────────────────┐
   │ canned_responses │        │   sla_rules      │
   │──────────────────│        │──────────────────│
   │ id (PK)          │        │ id (PK)          │
   │ name             │        │ priority         │
   │ category         │        │ first_resp_min   │
   │ content          │        │ resolution_min   │
   │ ...              │        │ ...              │
   └──────────────────┘        └──────────────────┘

   ┌──────────────────┐
   │ email_settings   │
   │──────────────────│
   │ id (PK)          │
   │ provider         │
   │ from_email       │
   │ ...              │
   └──────────────────┘
```

---

## 12. Knowledge Base System

### 12.1 Design

The knowledge base serves two audiences:

1. **AI Chatbot** --- Automatically searches KB during conversations to inject relevant context into the system prompt. Only sees articles with `visibility: 'all'` or `'ai_only'`.

2. **Human VAs** --- Manually searches KB from within ticket workspace, or gets AI-suggested articles. Sees all articles including `visibility: 'internal'` (internal procedures, escalation scripts, etc.).

### 12.2 Article Structure

```
Knowledge Article
├── title: "30-Day Return Policy"
├── content: (markdown)
│   "We offer free returns within 30 days of delivery..."
├── category: "Returns"
├── visibility: "all"
├── priority: 9 (higher = more likely to surface)
├── enabled: true
├── usage_count: 142
├── tags: ["returns", "refund", "exchange"]
├── last_used_at: "2026-03-08T14:30:00Z"
```

### 12.3 Categories

| Category | Purpose | Typical Audience |
|---|---|---|
| Shipping | Shipping policies, timelines, carriers | AI + VA |
| Returns | Return/exchange policy, process | AI + VA |
| Products | Product care, sizing, materials | AI + VA |
| Policies | Store policies (privacy, terms) | AI + VA |
| FAQ | Frequently asked questions | AI + VA |
| Troubleshooting | Common issue resolution steps | AI + VA |
| Internal Procedures | VA-only procedures (refund approval, escalation scripts) | VA only |
| Canned Responses | Template responses (also in canned_responses table) | VA only |

### 12.4 Search Improvements

The current KB search uses basic substring matching. Recommended upgrades:

**Phase 1 (MVP):** Improved text search using PostgreSQL `tsvector` full-text search instead of `ilike`. Better relevance ranking, support for word stemming.

**Phase 2:** Semantic search using embeddings. Store article embeddings in a `vector` column (Supabase supports `pgvector`). On search, embed the query and find nearest neighbors. Dramatically better for natural language queries.

---

## 13. Insights & Analytics

### 13.1 Insights Page Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  INSIGHTS                                    [Last 7 days ▼] [Export]   │
│                                                                          │
│  ┌─── OVERALL METRICS ──────────────────────────────────────────────┐   │
│  │                                                                   │   │
│  │  Total Inquiries   AI Resolved    Tickets Created   Resolution   │   │
│  │      156              121 (78%)       35 (22%)       Rate: 94%   │   │
│  │                                                                   │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─── TICKET METRICS ───────────────────────────────────────────────┐   │
│  │                                                                   │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │   │
│  │  │ Avg First│  │ Avg Resol│  │ SLA      │  │ Reopen   │         │   │
│  │  │ Response │  │ Time     │  │ Compliance│  │ Rate     │         │   │
│  │  │  2.1h    │  │  6.4h    │  │  94%     │  │  3%      │         │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘         │   │
│  │                                                                   │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌─── CHARTS ────────────────────────────────────────────────────────┐  │
│  │                                                                    │  │
│  │  [Volume Over Time]  Chart: stacked area (AI resolved vs tickets) │  │
│  │                                                                    │  │
│  │  [Tickets by Source]  Chart: pie (email, form, AI escalation)     │  │
│  │                                                                    │  │
│  │  [Tickets by Category]  Chart: horizontal bar                     │  │
│  │                                                                    │  │
│  │  [Response Time Distribution]  Chart: histogram                   │  │
│  │                                                                    │  │
│  │  [AI Tool Usage]  Chart: bar (which tools are used most)          │  │
│  │                                                                    │  │
│  │  [Satisfaction Trend]  Chart: line (AI + ticket satisfaction)      │  │
│  │                                                                    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌─── TOP ISSUES ────────────────────────────────────────────────────┐  │
│  │                                                                    │  │
│  │  1. Wrong size received  (12 tickets, 34%)                        │  │
│  │  2. Shipping delays      (8 tickets, 23%)                         │  │
│  │  3. Refund requests      (6 tickets, 17%)                         │  │
│  │  4. Product quality      (5 tickets, 14%)                         │  │
│  │  5. Missing items        (4 tickets, 11%)                         │  │
│  │                                                                    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 13.2 Key Metrics

**AI Chatbot Metrics:**
- Total AI conversations
- AI auto-resolution rate (% of conversations that resolved without escalation)
- Average AI conversation duration
- Most used AI tools
- AI token usage (cost tracking)
- AI satisfaction scores

**Ticket Metrics:**
- Total tickets by source, category, priority
- Average first response time
- Average resolution time
- SLA compliance rate
- Ticket reopen rate
- Agent-specific metrics (tickets handled, avg response time)
- Customer satisfaction (post-resolution survey)

**Combined Metrics:**
- Total inquiries (AI conversations + tickets)
- Overall resolution rate
- Escalation rate
- Customer satisfaction trend
- Top issue categories
- Busiest hours/days

---

## 14. Email System

### 14.1 Provider Selection

**Recommended: Resend**

Reasons:
- Modern API, developer-friendly
- Inbound email support (webhook-based)
- Good deliverability
- Simple pricing
- React Email integration (for HTML templates later)
- Good documentation

Alternative: SendGrid (more mature, higher volume), Postmark (best deliverability).

### 14.2 Outbound Email Flow

```
VA clicks "Send Reply"
        │
        ▼
  Backend: email.service.ts
        │
        ├── Build email:
        │   ├── To: customer_email
        │   ├── From: "Support <support@yourdomain.com>"
        │   ├── Subject: "Re: {original_subject} [#{ticket_number}]"
        │   ├── In-Reply-To: {last_customer_email_message_id}
        │   ├── References: {email thread references}
        │   ├── Body (HTML): styled reply + signature
        │   └── Body (text): plain text fallback
        │
        ├── Send via Resend API
        │
        ├── Store message in ticket_messages:
        │   ├── sender_type: 'agent'
        │   ├── content: plain text version
        │   ├── content_html: HTML version
        │   └── email_message_id: returned from Resend
        │
        └── Log ticket_event: 'agent_replied'
```

### 14.3 Inbound Email Flow

```
Customer sends email
        │
        ▼
  Resend receives at support@yourdomain.com
        │
        ▼
  Resend POSTs webhook to:
  POST /api/webhooks/email/inbound
        │
        ▼
  Backend validates webhook signature
        │
        ▼
  Parse: from, subject, body_text, body_html, attachments, headers
        │
        ▼
  Check threading:
  ├── Subject contains [#NNNN]? → find ticket by number
  ├── In-Reply-To matches known email_message_id? → find ticket
  └── Neither? → Create new ticket
        │
        ├── EXISTING TICKET:
        │   ├── Append message to thread
        │   ├── If ticket was resolved/closed → reopen (set status: 'open')
        │   ├── Log event: 'customer_replied'
        │   └── Notify assigned agent
        │
        └── NEW TICKET:
            ├── Create ticket (source: 'email')
            ├── Create first message
            ├── Auto-detect priority from keywords
            ├── Resolve Shopify customer ID from email
            ├── Log event: 'created'
            └── Send auto-reply confirmation
```

### 14.4 Auto-Reply Email

When a new ticket is created (any source), send a confirmation:

```
Subject: We received your request [#1047]

Hi {customer_name},

Thanks for reaching out. We've received your request and our team will
get back to you within {sla_response_time}.

Your ticket number is #{ticket_number}. You can reply to this email
to add more details.

Best,
{brand_name} Support
```

### 14.5 Email Signature

Appended to every outbound email from the ticket system:

```html
<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee;">
  <p style="color: #666; font-size: 13px;">
    {agent_name}<br>
    {brand_name} Support<br>
    <a href="{store_url}">{store_url}</a>
  </p>
</div>
```

---

## 15. Contact Form

### 15.1 Form Design

The contact form is a lightweight, embeddable component for the Shopify "Contact Us" page.

**Embed options:**

1. **Shopify Liquid snippet** --- Directly in the theme's `page.contact.liquid` template
2. **JavaScript widget** --- A `<script>` tag (like the chat widget) that renders the form
3. **Simple HTML form** --- Plain `<form>` that POSTs to the backend API

**Recommended: JavaScript widget approach** (consistent with the chat widget pattern, no theme modifications needed).

### 15.2 Form Fields

```
┌──────────────────────────────────────────┐
│  CONTACT US                              │
│                                          │
│  We'd love to hear from you.             │
│  Fill out the form below and we'll       │
│  get back to you as soon as possible.    │
│                                          │
│  Name *                                  │
│  ┌──────────────────────────────────┐   │
│  │ Your full name                    │   │
│  └──────────────────────────────────┘   │
│                                          │
│  Email *                                 │
│  ┌──────────────────────────────────┐   │
│  │ your@email.com                    │   │
│  └──────────────────────────────────┘   │
│                                          │
│  What can we help with? *                │
│  ┌──────────────────────────────────┐   │
│  │ Order Issue                    ▼  │   │
│  └──────────────────────────────────┘   │
│                                          │
│  Order Number (if applicable)            │
│  ┌──────────────────────────────────┐   │
│  │ #1234                             │   │
│  └──────────────────────────────────┘   │
│                                          │
│  Subject *                               │
│  ┌──────────────────────────────────┐   │
│  │ Brief description                 │   │
│  └──────────────────────────────────┘   │
│                                          │
│  Message *                               │
│  ┌──────────────────────────────────┐   │
│  │                                   │   │
│  │ Tell us more about your issue...  │   │
│  │                                   │   │
│  │                                   │   │
│  └──────────────────────────────────┘   │
│                                          │
│  Attachments (optional, max 3 files)     │
│  [Choose Files]                          │
│                                          │
│  [      Submit      ]                    │
│                                          │
└──────────────────────────────────────────┘
```

### 15.3 Form Submission Flow

```
Customer fills out form → clicks Submit
        │
        ▼
  Client-side validation (required fields, email format, file sizes)
        │
        ▼
  POST /api/tickets/form
  {
    name, email, category, order_number,
    subject, message, attachments (multipart)
  }
        │
        ▼
  Backend:
  ├── Validate inputs (server-side)
  ├── Check rate limit (max 5 submissions per email per hour)
  ├── Upload attachments to Supabase Storage
  ├── Resolve Shopify customer ID from email
  ├── Create ticket (source: 'form', priority from category)
  ├── Create first message (content: message, attachments: URLs)
  ├── Log event: 'created'
  ├── Send auto-reply confirmation email
  └── Return: { success: true, ticketNumber: '#1047' }
        │
        ▼
  Form shows confirmation:
  ┌──────────────────────────────────────────┐
  │  Thank you!                               │
  │                                           │
  │  Your request has been received.          │
  │  Ticket number: #1047                     │
  │                                           │
  │  We'll get back to you at                 │
  │  sarah@email.com within 8 hours.          │
  │                                           │
  │  [Submit Another Request]                 │
  └──────────────────────────────────────────┘
```

### 15.4 Spam Prevention

- Honeypot field (hidden input, if filled = bot)
- Rate limiting per email (5/hour) and per IP (10/hour)
- Cloudflare Turnstile (free, privacy-friendly CAPTCHA alternative) --- optional
- Server-side validation of all inputs

---

## 16. API Design

### 16.1 New Endpoints

All new endpoints live alongside the existing API. Ticket endpoints require agent authentication (JWT from agent login).

#### Ticket CRUD

```
POST   /api/tickets                    Create ticket (from form, email webhook, or AI escalation)
GET    /api/tickets                    List tickets (with filters, pagination, search)
GET    /api/tickets/:id               Get ticket detail (with messages, events, customer profile)
PATCH  /api/tickets/:id               Update ticket (status, priority, assignment, tags)
DELETE /api/tickets/:id               Soft-delete (archive) ticket

GET    /api/tickets/:id/messages      Get ticket messages
POST   /api/tickets/:id/messages      Add message (reply or internal note)

GET    /api/tickets/:id/events        Get audit log for ticket
```

#### Ticket Form Submission (Public)

```
POST   /api/tickets/form              Submit contact form (public, rate-limited)
```

#### Email Webhooks

```
POST   /api/webhooks/email/inbound    Inbound email webhook (from email provider)
POST   /api/webhooks/email/status     Email delivery status webhook (bounces, etc.)
```

#### AI Tools for Ticket Workspace

```
POST   /api/tickets/:id/ai/draft     Generate AI reply draft
POST   /api/tickets/:id/ai/summarize Summarize ticket thread
POST   /api/tickets/:id/ai/suggest   Get AI-suggested next steps
```

#### Shopify Actions

```
POST   /api/shopify/orders/:id/cancel      Cancel order
POST   /api/shopify/orders/:id/refund      Issue refund
POST   /api/shopify/orders/:id/return      Create return
POST   /api/shopify/discounts              Create discount code
GET    /api/shopify/customers/:email       Get customer profile
GET    /api/shopify/customers/:email/orders Get customer orders
```

#### Agent Management

```
POST   /api/agents/login              Agent login (returns JWT)
POST   /api/agents/logout             Agent logout
GET    /api/agents                    List agents (admin only)
POST   /api/agents                    Create agent (admin only)
PATCH  /api/agents/:id               Update agent
```

#### Settings

```
GET    /api/settings/email            Get email settings
PUT    /api/settings/email            Update email settings
GET    /api/settings/sla              Get SLA rules
PUT    /api/settings/sla              Update SLA rules
GET    /api/settings/canned-responses List canned responses
POST   /api/settings/canned-responses Create canned response
PATCH  /api/settings/canned-responses/:id Update
DELETE /api/settings/canned-responses/:id Delete
```

#### Analytics

```
GET    /api/analytics/overview        Overall KPIs
GET    /api/analytics/tickets         Ticket-specific analytics
GET    /api/analytics/ai              AI chatbot analytics
GET    /api/analytics/agents          Per-agent performance
GET    /api/analytics/satisfaction    Satisfaction trends
```

### 16.2 Query Parameters for Ticket List

```
GET /api/tickets?status=open&priority=high&source=email&assigned_to=me&category=order_issue&search=sarah&order_by=sla_deadline&order=asc&page=1&per_page=25
```

| Param | Type | Description |
|---|---|---|
| status | string | Filter by status (comma-separated for multiple) |
| priority | string | Filter by priority |
| source | string | Filter by source |
| assigned_to | string | 'me', 'unassigned', or agent UUID |
| category | string | Filter by category |
| search | string | Full-text search across subject, messages, customer email |
| tags | string | Filter by tag (comma-separated) |
| sla_breached | boolean | Only show breached tickets |
| order_by | string | Sort field: created_at, updated_at, sla_deadline, priority, ticket_number |
| order | string | asc or desc |
| page | number | Page number (default 1) |
| per_page | number | Results per page (default 25, max 100) |

---

## 17. Deployment Architecture

### 17.1 Updated Deployment Map

```
┌─────────────────────────────────────────────────────────┐
│                    RAILWAY                                │
│                                                          │
│  Backend API Server                                      │
│  ├── Chat API (existing)                                 │
│  ├── Ticket API (new)                                    │
│  ├── Webhook endpoints (new)                             │
│  ├── Shopify action endpoints (new)                      │
│  ├── Widget static files (existing)                      │
│  └── Contact form widget files (new)                     │
│                                                          │
│  URL: shopify-ai-chatbot-production-*.up.railway.app    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    VERCEL                                 │
│                                                          │
│  Admin Dashboard (Next.js)                               │
│  ├── Main Overview                                       │
│  ├── Ticket Inbox (new)                                  │
│  ├── AI Chatbot Dashboard (restructured from existing)   │
│  ├── Knowledge Base (enhanced)                           │
│  ├── Insights (enhanced)                                 │
│  └── Settings (new)                                      │
│                                                          │
│  URL: admin.yourdomain.com                               │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                    SUPABASE                               │
│                                                          │
│  PostgreSQL Database                                     │
│  ├── Existing tables (conversations, messages, etc.)     │
│  ├── New tables (tickets, ticket_messages, etc.)         │
│  ├── Storage (email attachments, form uploads)           │
│  └── Realtime (ticket updates for live inbox refresh)    │
│                                                          │
│  Project: wwblkodkycjwmzlflncg                          │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                 EMAIL PROVIDER (Resend)                   │
│                                                          │
│  ├── Outbound: Send ticket replies, confirmations        │
│  ├── Inbound: Receive emails → webhook to backend        │
│  └── Domain: support@yourdomain.com                      │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                 SHOPIFY STORE                             │
│                                                          │
│  ├── Chat widget embed (existing <script> tag)           │
│  ├── Contact form embed (new <script> tag or Liquid)     │
│  └── Admin API (GraphQL, for customer/order data)        │
│                                                          │
│  Store: put1rp-iq.myshopify.com                         │
└─────────────────────────────────────────────────────────┘
```

### 17.2 New Backend Services

```
apps/backend/src/
├── services/
│   ├── (existing services unchanged)
│   ├── ticket.service.ts          ← Ticket CRUD, status management, SLA calculation
│   ├── email.service.ts           ← Outbound email via Resend, template rendering
│   ├── email-inbound.service.ts   ← Inbound email parsing, ticket routing
│   ├── contact-form.service.ts    ← Form submission processing
│   ├── customer-profile.service.ts← Unified customer profile from Shopify
│   ├── notification.service.ts    ← Agent notifications (browser push, in-app)
│   ├── sla.service.ts             ← SLA deadline calculation, breach detection
│   ├── ai-assistant.service.ts    ← AI tools for ticket workspace (draft, summarize, suggest)
│   └── shopify-actions.service.ts ← Write operations (cancel, refund, discount, etc.)
│
├── controllers/
│   ├── (existing controllers unchanged)
│   ├── ticket.controller.ts       ← Ticket REST endpoints
│   ├── webhook.controller.ts      ← Email and delivery webhooks
│   ├── contact-form.controller.ts ← Public form submission endpoint
│   ├── shopify-actions.controller.ts ← Shopify write action endpoints
│   └── agent.controller.ts        ← Agent auth and management
│
├── middleware/
│   ├── agent-auth.middleware.ts   ← JWT validation for agent endpoints
│   └── webhook-verify.middleware.ts ← Webhook signature verification
│
└── jobs/
    ├── sla-checker.ts             ← Periodic job: check for SLA breaches
    └── auto-close.ts              ← Periodic job: auto-close resolved tickets after 48h
```

### 17.3 Updated Admin Dashboard Structure

```
apps/admin/src/app/
├── (dashboard)/
│   ├── layout.tsx                 ← Updated sidebar with new navigation
│   ├── overview/page.tsx          ← NEW: Master overview dashboard
│   │
│   ├── tickets/                   ← NEW: Ticket inbox section
│   │   ├── page.tsx               ← Ticket list with filters
│   │   └── [id]/page.tsx          ← Ticket detail + workspace
│   │
│   ├── chatbot/                   ← MOVED: Existing AI chatbot section
│   │   ├── conversations/page.tsx
│   │   ├── conversations/[id]/page.tsx
│   │   ├── playground/page.tsx
│   │   ├── ai-config/page.tsx
│   │   └── capabilities/page.tsx
│   │
│   ├── knowledge/page.tsx         ← ENHANCED: Existing KB page
│   ├── insights/page.tsx          ← NEW: Comprehensive analytics
│   │
│   └── settings/                  ← NEW: Multi-section settings
│       ├── page.tsx               ← General settings
│       ├── email/page.tsx         ← Email configuration
│       ├── sla/page.tsx           ← SLA rules
│       ├── canned-responses/page.tsx ← Template management
│       ├── contact-form/page.tsx  ← Form configuration
│       └── team/page.tsx          ← Agent management
│
└── api/
    ├── (existing routes)
    ├── tickets/                   ← NEW: Proxy to backend ticket API
    ├── shopify-actions/           ← NEW: Proxy to backend Shopify actions
    └── settings/                  ← NEW: Settings management
```

---

## 18. Implementation Phases

### Phase 1: Ticket Foundation

**Goal:** Core ticket system working end-to-end with AI escalation as the first ticket source.

**What gets built:**
- Database tables: tickets, ticket_messages, ticket_events, agents
- Backend: ticket.service.ts, ticket.controller.ts, agent auth
- Backend: Enhanced escalation flow (AI creates ticket, collects email, generates summary)
- Dashboard: Ticket inbox (list view + detail view)
- Dashboard: Reply composer (text only, no email sending yet --- just internal ticket management)
- Dashboard: Customer sidebar (Shopify profile + orders)
- Dashboard: Updated navigation (main overview, ticket inbox, AI chatbot section)

**Result:** AI escalations create tickets. VA can view and manage them in the inbox. No email integration yet --- this phase is about the ticket data model and inbox UI.

### Phase 2: Email Integration

**Goal:** Full email loop. Inbound emails create tickets, VA replies send emails, customer can reply back.

**What gets built:**
- Email provider setup (Resend account, domain verification, DNS records)
- Backend: email.service.ts (outbound), email-inbound.service.ts (inbound webhook)
- Backend: webhook.controller.ts with signature verification
- Email threading (In-Reply-To, References headers, [#NNNN] in subject)
- Auto-reply emails for new tickets
- Email signature configuration
- Dashboard: Email settings page
- Confirmation email for AI escalations

**Result:** Support email is live. Customers can email support@yourdomain.com, get auto-replies, and receive VA responses as emails. Full threading works.

### Phase 3: Contact Form

**Goal:** Embedded contact form on Shopify store.

**What gets built:**
- Backend: contact-form.service.ts, contact-form.controller.ts
- Contact form widget (JS embed or Liquid snippet)
- File upload handling (Supabase Storage)
- Spam prevention (honeypot, rate limiting)
- Dashboard: Contact form settings page
- Embed code generator

**Result:** "Contact Us" page has a form that creates tickets. Customers get confirmation with ticket number.

### Phase 4: AI Tools & Shopify Actions

**Goal:** Make the VA workspace powerful with AI assistance and direct Shopify actions.

**What gets built:**
- Backend: ai-assistant.service.ts (draft reply, summarize, suggest next steps)
- Backend: shopify-actions.service.ts (cancel order, refund, create return, create discount)
- Backend: customer-profile.service.ts (unified Shopify customer data)
- Dashboard: AI Draft button in reply composer
- Dashboard: Shopify Quick Actions panel
- Dashboard: AI suggestion badges
- Dashboard: Canned responses system
- New Shopify API scopes (write_orders, write_customers)

**Result:** VA has AI-powered draft replies, can execute Shopify actions directly from tickets, and has canned responses.

### Phase 5: SLA, Analytics & Polish

**Goal:** SLA tracking, comprehensive analytics, notification system, and UX polish.

**What gets built:**
- Backend: sla.service.ts, sla-checker job, auto-close job
- Backend: notification.service.ts (browser push, in-app)
- Dashboard: SLA indicators on tickets (countdown, breach alerts)
- Dashboard: Insights page (full analytics)
- Dashboard: SLA settings page
- Dashboard: Team management page
- Dashboard: Keyboard shortcuts
- Dashboard: Bulk actions on tickets
- Dashboard: Knowledge base enhancements (versioning, usage tracking, internal articles)
- Satisfaction survey (post-resolution email)

**Result:** Full-featured support platform with SLA enforcement, comprehensive analytics, and polished UX.

---

## Appendix A: Canned Response Examples

| Name | Category | Content |
|---|---|---|
| Greeting | Opening | Hi {customer_name}, thanks for reaching out! I'd be happy to help. |
| Request Photos | Returns | Could you send a few photos of the item showing the issue? This will help us process your request faster. |
| Refund Confirmation | Returns | Great news --- I've issued a refund of {amount} to your original payment method. Please allow 5-10 business days for it to appear on your statement. |
| Shipping Update | Shipping | Your order #{order_number} is on its way! You can track it here: {tracking_url}. Standard delivery takes 5-7 business days. |
| Discount Offer | Recovery | I'm sorry for the inconvenience. As a gesture of goodwill, here's a {discount_percent}% discount code for your next order: {discount_code}. It's valid for 30 days. |
| Closing | Closing | Is there anything else I can help you with? If not, I'll go ahead and close this ticket. Thanks for being a valued customer! |
| Escalation to Admin | Internal | Escalating to admin review. Customer is requesting {reason}. Awaiting approval before proceeding. |

---

## Appendix B: Ticket Priority Auto-Detection Keywords

**Urgent triggers** (in email subject or body):
- "scam", "fraud", "unauthorized charge", "stolen", "legal", "attorney", "BBB"

**High triggers:**
- "urgent", "ASAP", "immediately", "frustrated", "disappointed", "unacceptable", "worst", "never again", "refund now", "wrong item"

**These bump the default priority up by one level** (medium → high, high → urgent). They do not override manually set priorities.

---

## Appendix C: Notification Rules

| Event | Notification | Who |
|---|---|---|
| New ticket created | Browser push + in-app badge | All agents (or assigned) |
| Ticket assigned to you | Browser push + in-app badge | Assigned agent |
| Customer replied on your ticket | Browser push + sound | Assigned agent |
| SLA about to breach (30 min warning) | Browser push (red) | Assigned agent + admin |
| SLA breached | Browser push + in-app alert | All admins |
| New unassigned ticket (15 min old) | Browser push | All agents |

---

## Appendix D: Security Considerations

- **Agent authentication:** JWT with 24h expiry, httpOnly secure cookies
- **Webhook verification:** Validate email provider signatures on all inbound webhooks
- **API rate limiting:** Per-IP and per-email limits on public endpoints (form, widget)
- **Input sanitization:** All user input sanitized before storage and display (prevent XSS)
- **Email content:** Strip dangerous HTML from inbound emails (scripts, forms, iframes)
- **File uploads:** Validate file types (images, PDFs only), max 5MB, scan for malware (optional)
- **Shopify actions:** All write operations require agent auth + confirmation
- **CORS:** Dashboard and backend on separate origins, CORS configured for exact origins only
- **Supabase RLS:** All tables have Row Level Security with service role bypass only
- **Secrets:** Email API keys encrypted at rest in database, env vars for other secrets
- **Audit trail:** Every action logged in ticket_events for accountability
