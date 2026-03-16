import { Router } from 'express';
import * as ticketService from '../services/ticket.service.js';
import * as aiAssistant from '../services/ai-assistant.service.js';
import * as customerProfileService from '../services/customer-profile.service.js';
import { classifyTicketContent } from '../services/email-classifier.service.js';
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
      brand_id: req.agent?.brandId,
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
      brand_id: req.agent?.brandId,
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
    if (!ticket || (req.agent?.brandId && ticket.brand_id !== req.agent.brandId)) {
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
        customerProfile = await customerProfileService.getCustomerByEmail(ticket.customer_email, ticket.brand_id);
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
    const draft = await aiAssistant.draftReply(req.params.id, req.agent?.brandId);
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
    const steps = await aiAssistant.suggestNextSteps(req.params.id, req.agent?.brandId);
    res.json({ steps });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] POST /:id/ai/suggest error:', message);
    res.status(500).json({ error: 'Failed to generate AI suggestions' });
  }
});

// ── POST /bulk/update — Bulk Update Tickets ──────────────────────────────
ticketRouter.post('/bulk/update', async (req, res) => {
  try {
    const { ids, status, priority, category } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: 'ids array is required' });
      return;
    }

    if (ids.length > 100) {
      res.status(400).json({ error: 'Maximum 100 tickets per bulk operation' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (priority) updates.priority = priority;
    if (category) updates.category = category;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'At least one update field (status, priority, category) is required' });
      return;
    }

    const result = await ticketService.bulkUpdateTickets(
      ids,
      updates as Parameters<typeof ticketService.bulkUpdateTickets>[1],
      req.agent?.brandId,
      req.agent?.id
    );

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] POST /bulk/update error:', message);
    res.status(500).json({ error: 'Failed to bulk update tickets' });
  }
});

// ── POST /ai/classify-unclassified — Classify open tickets that have no classification ──
ticketRouter.post('/ai/classify-unclassified', async (req, res) => {
  try {
    const brandId = req.agent?.brandId;
    if (!brandId) {
      res.status(400).json({ error: 'Brand context required' });
      return;
    }

    const tickets = await ticketService.getUnclassifiedTickets(brandId, 50);
    if (tickets.length === 0) {
      res.json({ classified: 0, results: [] });
      return;
    }

    const results: Array<{ ticketId: string; ticketNumber: number; classification: string; confidence: number }> = [];

    for (const ticket of tickets) {
      // Get first customer message for classification
      const messages = await ticketService.getTicketMessages(ticket.id);
      const firstCustomerMsg = messages.find((m) => m.sender_type === 'customer');
      const content = firstCustomerMsg?.content || ticket.subject;

      const result = await classifyTicketContent({
        subject: ticket.subject,
        customerEmail: ticket.customer_email,
        firstMessage: content,
      });

      // Update ticket with classification
      await ticketService.updateTicket(ticket.id, {
        category: result.classification === 'customer_support' ? (ticket.category || 'customer_support') : result.classification,
      } as Parameters<typeof ticketService.updateTicket>[1]);

      // Update classification fields directly
      const { error } = await (await import('../config/supabase.js')).supabase
        .from('tickets')
        .update({
          classification: result.classification,
          classification_confidence: result.confidence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ticket.id);

      if (error) {
        console.error(`[ticket.controller] Failed to classify ticket #${ticket.ticket_number}:`, error.message);
      }

      results.push({
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        classification: result.classification,
        confidence: result.confidence,
      });
    }

    res.json({ classified: results.length, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] POST /ai/classify-unclassified error:', message);
    res.status(500).json({ error: 'Failed to classify tickets' });
  }
});

// ── POST /ai/auto-close-non-support — AI auto-close all non-support tickets ──
ticketRouter.post('/ai/auto-close-non-support', async (req, res) => {
  try {
    const brandId = req.agent?.brandId;
    if (!brandId) {
      res.status(400).json({ error: 'Brand context required' });
      return;
    }

    // First classify any unclassified tickets
    const unclassified = await ticketService.getUnclassifiedTickets(brandId, 100);
    const classified: string[] = [];

    for (const ticket of unclassified) {
      const messages = await ticketService.getTicketMessages(ticket.id);
      const firstCustomerMsg = messages.find((m) => m.sender_type === 'customer');
      const content = firstCustomerMsg?.content || ticket.subject;

      const result = await classifyTicketContent({
        subject: ticket.subject,
        customerEmail: ticket.customer_email,
        firstMessage: content,
      });

      const { error } = await (await import('../config/supabase.js')).supabase
        .from('tickets')
        .update({
          classification: result.classification,
          classification_confidence: result.confidence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ticket.id);

      if (!error) classified.push(ticket.id);
    }

    // Now close all non-support tickets
    const nonSupport = await ticketService.getNonSupportTickets(brandId);
    const idsToClose = nonSupport.map((t) => t.id);

    let closedCount = 0;
    if (idsToClose.length > 0) {
      const result = await ticketService.bulkUpdateTickets(
        idsToClose,
        { status: 'closed' },
        brandId,
        req.agent?.id
      );
      closedCount = result.updated;
    }

    res.json({
      classified: classified.length,
      closed: closedCount,
      closedTickets: nonSupport.map((t) => ({
        id: t.id,
        ticketNumber: t.ticket_number,
        subject: t.subject,
        classification: t.classification,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ticket.controller] POST /ai/auto-close-non-support error:', message);
    res.status(500).json({ error: 'Failed to auto-close non-support tickets' });
  }
});
