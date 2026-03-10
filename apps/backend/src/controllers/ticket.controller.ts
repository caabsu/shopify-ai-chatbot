import { Router } from 'express';
import * as ticketService from '../services/ticket.service.js';
import * as aiAssistant from '../services/ai-assistant.service.js';
import * as customerProfileService from '../services/customer-profile.service.js';
import { agentAuthMiddleware } from '../middleware/agent-auth.middleware.js';

export const ticketRouter = Router();

// All ticket routes require agent authentication
ticketRouter.use(agentAuthMiddleware);

// ── GET / — List Tickets ───────────────────────────────────────────────────
ticketRouter.get('/', async (req, res) => {
  try {
    const {
      status,
      priority,
      source,
      assigned_to,
      category,
      search,
      tags,
      sla_breached,
      page,
      per_page,
      order_by,
      order,
    } = req.query;

    const result = await ticketService.listTickets({
      status: status as string | undefined,
      priority: priority as string | undefined,
      source: source as string | undefined,
      assigned_to: assigned_to as string | undefined,
      category: category as string | undefined,
      search: search as string | undefined,
      tags: tags ? (Array.isArray(tags) ? tags as string[] : [tags as string]) : undefined,
      sla_breached: sla_breached !== undefined ? sla_breached === 'true' : undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      perPage: per_page ? parseInt(per_page as string, 10) : undefined,
      order_by: order_by as string | undefined,
      order: order as 'asc' | 'desc' | undefined,
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] GET / error:', message);
    res.status(500).json({ error: 'Failed to list tickets' });
  }
});

// ── POST / — Create Ticket ─────────────────────────────────────────────────
ticketRouter.post('/', async (req, res) => {
  try {
    const { source, subject, customer_email, customer_name, customer_phone, priority, category, order_id, tags, metadata } = req.body;

    if (!subject || !customer_email) {
      res.status(400).json({ error: 'subject and customer_email are required' });
      return;
    }

    const ticket = await ticketService.createTicket({
      source: source ?? 'form',
      subject,
      customer_email,
      customer_name,
      customer_phone,
      priority,
      category,
      order_id,
      tags,
      metadata,
    });

    res.status(201).json(ticket);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] POST / error:', message);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

// ── GET /:id — Get Ticket with Messages, Events, Customer Profile ──────────
ticketRouter.get('/:id', async (req, res) => {
  try {
    const ticket = await ticketService.getTicket(req.params.id);
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    const [messages, events] = await Promise.all([
      ticketService.getTicketMessages(ticket.id),
      ticketService.getTicketEvents(ticket.id),
    ]);

    let customerProfile = null;
    if (ticket.customer_email) {
      try {
        customerProfile = await customerProfileService.getCustomerByEmail(ticket.customer_email);
      } catch {
        // Non-critical — continue without customer profile
      }
    }

    res.json({ ticket, messages, events, customerProfile });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] GET /:id error:', message);
    res.status(500).json({ error: 'Failed to get ticket' });
  }
});

// ── PATCH /:id — Update Ticket ──────────────────────────────────────────────
ticketRouter.patch('/:id', async (req, res) => {
  try {
    const { status, priority, category, assigned_to, tags, subject, metadata } = req.body;

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (priority !== undefined) updates.priority = priority;
    if (category !== undefined) updates.category = category;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    if (tags !== undefined) updates.tags = tags;
    if (subject !== undefined) updates.subject = subject;
    if (metadata !== undefined) updates.metadata = metadata;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    const ticket = await ticketService.updateTicket(
      req.params.id,
      updates as Parameters<typeof ticketService.updateTicket>[1],
      req.agent?.id
    );

    res.json(ticket);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'Ticket not found') {
      res.status(404).json({ error: message });
      return;
    }
    console.error('[ticket.controller] PATCH /:id error:', message);
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// ── GET /:id/messages — Get Ticket Messages ─────────────────────────────────
ticketRouter.get('/:id/messages', async (req, res) => {
  try {
    const messages = await ticketService.getTicketMessages(req.params.id);
    res.json(messages);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] GET /:id/messages error:', message);
    res.status(500).json({ error: 'Failed to get ticket messages' });
  }
});

// ── POST /:id/messages — Add Ticket Message ─────────────────────────────────
ticketRouter.post('/:id/messages', async (req, res) => {
  try {
    const { sender_type, content, content_html, is_internal_note, attachments, ai_generated } = req.body;

    if (!content) {
      res.status(400).json({ error: 'content is required' });
      return;
    }

    const ticketMessage = await ticketService.addTicketMessage(req.params.id, {
      sender_type: sender_type ?? 'agent',
      sender_name: req.agent?.name,
      sender_email: req.agent?.email,
      content,
      content_html,
      is_internal_note: is_internal_note ?? false,
      attachments,
      ai_generated: ai_generated ?? false,
    });

    res.status(201).json(ticketMessage);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] POST /:id/messages error:', message);
    res.status(500).json({ error: 'Failed to add ticket message' });
  }
});

// ── GET /:id/events — Get Ticket Events (Audit Log) ────────────────────────
ticketRouter.get('/:id/events', async (req, res) => {
  try {
    const events = await ticketService.getTicketEvents(req.params.id);
    res.json(events);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] GET /:id/events error:', message);
    res.status(500).json({ error: 'Failed to get ticket events' });
  }
});

// ── POST /:id/ai/draft — AI Draft Reply ────────────────────────────────────
ticketRouter.post('/:id/ai/draft', async (req, res) => {
  try {
    const draft = await aiAssistant.draftReply(req.params.id);
    res.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] POST /:id/ai/draft error:', message);
    res.status(500).json({ error: 'Failed to generate AI draft' });
  }
});

// ── POST /:id/ai/summarize — AI Summarize Thread ───────────────────────────
ticketRouter.post('/:id/ai/summarize', async (req, res) => {
  try {
    const summary = await aiAssistant.summarizeThread(req.params.id);
    res.json({ summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] POST /:id/ai/summarize error:', message);
    res.status(500).json({ error: 'Failed to generate AI summary' });
  }
});

// ── POST /:id/ai/suggest — AI Suggest Next Steps ───────────────────────────
ticketRouter.post('/:id/ai/suggest', async (req, res) => {
  try {
    const steps = await aiAssistant.suggestNextSteps(req.params.id);
    res.json({ steps });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] POST /:id/ai/suggest error:', message);
    res.status(500).json({ error: 'Failed to generate AI suggestions' });
  }
});
