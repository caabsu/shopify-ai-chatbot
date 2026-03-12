import { Router } from 'express';
import { resolveBrandId } from '../config/brand.js';
import * as returnService from '../services/return.service.js';
import * as returnRulesService from '../services/return-rules.service.js';
import * as returnAIService from '../services/return-ai.service.js';
import {
  sendReturnConfirmation,
  sendReturnApproved,
  sendReturnDenied,
  sendReturnRefunded,
} from '../services/email.service.js';
import { lookupOrder } from '../services/shopify-admin.service.js';

export const returnRouter = Router();

// ── POST /submit — Customer Submits a Return Request ─────────────────────
returnRouter.post('/submit', async (req, res) => {
  try {
    const { order_id, order_number, customer_email, customer_name, items } = req.body;

    if (!order_id || !order_number || !customer_email || !items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'order_id, order_number, customer_email, and items are required' });
      return;
    }

    const brandId = await resolveBrandId(req);

    // 1. Create return request
    const returnRequest = await returnService.createReturnRequest({
      brand_id: brandId,
      order_id,
      order_number,
      customer_email,
      customer_name,
      items,
    });

    // 2. Evaluate rules
    // We need order data for rule evaluation — fetch minimal order info
    let orderData = { created_at: new Date().toISOString(), total_price: 0 };
    try {
      const orderResult = await lookupOrder(order_number, customer_email, undefined, brandId);
      if (orderResult.found && orderResult.order) {
        orderData = {
          created_at: orderResult.order.createdAt,
          total_price: orderResult.order.lineItems.reduce(
            (sum, li) => sum + parseFloat(li.price) * li.quantity,
            0
          ),
        };
      }
    } catch (err) {
      console.error('[return.controller] Order lookup for rule eval failed:', err instanceof Error ? err.message : err);
    }

    const ruleResult = await returnRulesService.evaluateRules(brandId, returnRequest, orderData);

    const itemsSummary = (returnRequest.items ?? [])
      .map((i) => `${i.product_title} (x${i.quantity})`)
      .join(', ');

    // 3. Act on rule evaluation
    if (ruleResult.action === 'auto_approve') {
      const updated = await returnService.updateReturnRequest(returnRequest.id, {
        status: 'approved',
        resolution_type: ruleResult.resolution_type ?? 'refund',
        decided_at: new Date().toISOString(),
        decided_by: 'system_rule',
      });

      // Send confirmation + approval emails (fire-and-forget)
      sendReturnConfirmation({
        to: customer_email,
        customerName: customer_name,
        returnRequestId: returnRequest.id,
        orderNumber: order_number,
        items: itemsSummary,
        brandName: undefined,
      }).catch((err) => console.error('[return.controller] Confirmation email failed:', err));

      sendReturnApproved({
        to: customer_email,
        customerName: customer_name,
        returnRequestId: returnRequest.id,
        orderNumber: order_number,
        items: itemsSummary,
      }).catch((err) => console.error('[return.controller] Approval email failed:', err));

      res.status(201).json({ return_request: updated, status: 'approved' });
      return;
    }

    if (ruleResult.action === 'auto_deny') {
      const updated = await returnService.updateReturnRequest(returnRequest.id, {
        status: 'denied',
        decided_at: new Date().toISOString(),
        decided_by: 'system_rule',
      });

      sendReturnConfirmation({
        to: customer_email,
        customerName: customer_name,
        returnRequestId: returnRequest.id,
        orderNumber: order_number,
        items: itemsSummary,
      }).catch((err) => console.error('[return.controller] Confirmation email failed:', err));

      sendReturnDenied({
        to: customer_email,
        customerName: customer_name,
        returnRequestId: returnRequest.id,
        orderNumber: order_number,
        items: itemsSummary,
        reason: 'Your return request does not meet our return policy requirements.',
      }).catch((err) => console.error('[return.controller] Denial email failed:', err));

      res.status(201).json({ return_request: updated, status: 'denied' });
      return;
    }

    if (ruleResult.action === 'ai_review') {
      // Call AI for recommendation
      const aiRecommendation = await returnAIService.getAIRecommendation(
        returnRequest,
        returnRequest.items ?? [],
        orderData,
      );

      // Store AI recommendation
      const aiUpdatePayload: Parameters<typeof returnService.updateReturnRequest>[1] = {
        ai_recommendation: {
          decision: aiRecommendation.decision,
          confidence: aiRecommendation.confidence,
          reasoning: aiRecommendation.reasoning,
          suggested_resolution: aiRecommendation.suggested_resolution,
        },
      };

      // If AI is confident enough, auto-execute
      if (aiRecommendation.confidence >= 0.85 && aiRecommendation.decision === 'approve') {
        aiUpdatePayload.status = 'approved';
        aiUpdatePayload.resolution_type = aiRecommendation.suggested_resolution === 'exchange'
          ? 'exchange'
          : aiRecommendation.suggested_resolution === 'store_credit'
            ? 'store_credit'
            : 'refund';
        aiUpdatePayload.decided_at = new Date().toISOString();
        aiUpdatePayload.decided_by = 'ai_auto';

        const updated = await returnService.updateReturnRequest(returnRequest.id, aiUpdatePayload);

        sendReturnConfirmation({
          to: customer_email,
          customerName: customer_name,
          returnRequestId: returnRequest.id,
          orderNumber: order_number,
          items: itemsSummary,
        }).catch((err) => console.error('[return.controller] Confirmation email failed:', err));

        sendReturnApproved({
          to: customer_email,
          customerName: customer_name,
          returnRequestId: returnRequest.id,
          orderNumber: order_number,
          items: itemsSummary,
        }).catch((err) => console.error('[return.controller] Approval email failed:', err));

        res.status(201).json({ return_request: updated, status: 'approved' });
        return;
      }

      if (aiRecommendation.confidence >= 0.85 && aiRecommendation.decision === 'deny') {
        aiUpdatePayload.status = 'denied';
        aiUpdatePayload.decided_at = new Date().toISOString();
        aiUpdatePayload.decided_by = 'ai_auto';

        const updated = await returnService.updateReturnRequest(returnRequest.id, aiUpdatePayload);

        sendReturnConfirmation({
          to: customer_email,
          customerName: customer_name,
          returnRequestId: returnRequest.id,
          orderNumber: order_number,
          items: itemsSummary,
        }).catch((err) => console.error('[return.controller] Confirmation email failed:', err));

        sendReturnDenied({
          to: customer_email,
          customerName: customer_name,
          returnRequestId: returnRequest.id,
          orderNumber: order_number,
          items: itemsSummary,
          reason: aiRecommendation.reasoning,
        }).catch((err) => console.error('[return.controller] Denial email failed:', err));

        res.status(201).json({ return_request: updated, status: 'denied' });
        return;
      }

      // AI not confident enough — leave as pending_review
      aiUpdatePayload.status = 'pending_review';
      const updated = await returnService.updateReturnRequest(returnRequest.id, aiUpdatePayload);

      sendReturnConfirmation({
        to: customer_email,
        customerName: customer_name,
        returnRequestId: returnRequest.id,
        orderNumber: order_number,
        items: itemsSummary,
      }).catch((err) => console.error('[return.controller] Confirmation email failed:', err));

      res.status(201).json({ return_request: updated, status: 'pending_review' });
      return;
    }

    // flag_review or default — leave as pending_review
    sendReturnConfirmation({
      to: customer_email,
      customerName: customer_name,
      returnRequestId: returnRequest.id,
      orderNumber: order_number,
      items: itemsSummary,
    }).catch((err) => console.error('[return.controller] Confirmation email failed:', err));

    res.status(201).json({ return_request: returnRequest, status: 'pending_review' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] POST /submit error:', message);
    res.status(500).json({ error: 'Failed to submit return request' });
  }
});

// ── GET /lookup — Customer Looks Up Order for Return Eligibility ──────────
returnRouter.get('/lookup', async (req, res) => {
  try {
    const { order_number, email } = req.query;

    if (!order_number || !email) {
      res.status(400).json({ error: 'order_number and email are required' });
      return;
    }

    const brandId = await resolveBrandId(req);

    const orderResult = await lookupOrder(
      order_number as string,
      email as string,
      undefined,
      brandId,
    );

    if (!orderResult.found || !orderResult.order) {
      res.status(404).json({ error: orderResult.message || 'Order not found' });
      return;
    }

    // Check return eligibility for each line item
    const { checkReturnEligibility } = await import('../services/shopify-admin.service.js');
    const eligibility = await checkReturnEligibility(orderResult.order.id, brandId);

    // Merge eligibility info into line items
    const eligibleItems = orderResult.order.lineItems.map((li) => {
      const eligibilityInfo = eligibility.items.find((e) => e.lineItemId === li.id);
      return {
        ...li,
        eligible: eligibilityInfo?.eligible ?? false,
        eligibility_reason: eligibilityInfo?.reason ?? 'Unknown',
      };
    });

    res.json({
      order: {
        id: orderResult.order.id,
        name: orderResult.order.name,
        createdAt: orderResult.order.createdAt,
        financialStatus: orderResult.order.financialStatus,
        fulfillmentStatus: orderResult.order.fulfillmentStatus,
      },
      items: eligibleItems,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET /lookup error:', message);
    res.status(500).json({ error: 'Failed to look up order' });
  }
});

// ── GET /stats — Return Stats by Status ──────────────────────────────────
// NOTE: This route MUST be registered before /:id to avoid matching "stats" as an id
returnRouter.get('/stats', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const stats = await returnService.getReturnStats(brandId);
    res.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET /stats error:', message);
    res.status(500).json({ error: 'Failed to get return stats' });
  }
});

// ── GET /rules — List Rules for Brand ────────────────────────────────────
returnRouter.get('/rules', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const rules = await returnRulesService.getRules(brandId);
    res.json(rules);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET /rules error:', message);
    res.status(500).json({ error: 'Failed to list return rules' });
  }
});

// ── POST /rules — Create Rule ────────────────────────────────────────────
returnRouter.post('/rules', async (req, res) => {
  try {
    const { name, enabled, priority, conditions, action, resolution_type } = req.body;

    if (!name || !conditions || !action) {
      res.status(400).json({ error: 'name, conditions, and action are required' });
      return;
    }

    const brandId = await resolveBrandId(req);
    const rule = await returnRulesService.createRule(brandId, {
      name,
      enabled,
      priority,
      conditions,
      action,
      resolution_type,
    });

    res.status(201).json(rule);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] POST /rules error:', message);
    res.status(500).json({ error: 'Failed to create return rule' });
  }
});

// ── PATCH /rules/:id — Update Rule ───────────────────────────────────────
returnRouter.patch('/rules/:id', async (req, res) => {
  try {
    const { name, enabled, priority, conditions, action, resolution_type } = req.body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (enabled !== undefined) updates.enabled = enabled;
    if (priority !== undefined) updates.priority = priority;
    if (conditions !== undefined) updates.conditions = conditions;
    if (action !== undefined) updates.action = action;
    if (resolution_type !== undefined) updates.resolution_type = resolution_type;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    const rule = await returnRulesService.updateRule(
      req.params.id,
      updates as Parameters<typeof returnRulesService.updateRule>[1],
    );

    res.json(rule);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }
    console.error('[return.controller] PATCH /rules/:id error:', message);
    res.status(500).json({ error: 'Failed to update return rule' });
  }
});

// ── DELETE /rules/:id — Delete Rule ──────────────────────────────────────
returnRouter.delete('/rules/:id', async (req, res) => {
  try {
    await returnRulesService.deleteRule(req.params.id);
    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] DELETE /rules/:id error:', message);
    res.status(500).json({ error: 'Failed to delete return rule' });
  }
});

// ── GET / — List Return Requests ─────────────────────────────────────────
returnRouter.get('/', async (req, res) => {
  try {
    const { status, page, per_page, search } = req.query;
    const brandId = await resolveBrandId(req);

    const result = await returnService.getReturnRequests(brandId, {
      status: status as string | undefined,
      customer_email: search as string | undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      perPage: per_page ? parseInt(per_page as string, 10) : undefined,
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET / error:', message);
    res.status(500).json({ error: 'Failed to list return requests' });
  }
});

// ── GET /:id — Get Single Return Request with Items ──────────────────────
returnRouter.get('/:id', async (req, res) => {
  try {
    const returnRequest = await returnService.getReturnRequest(req.params.id);

    if (!returnRequest) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    res.json(returnRequest);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET /:id error:', message);
    res.status(500).json({ error: 'Failed to get return request' });
  }
});

// ── PATCH /:id — Update Return Request ───────────────────────────────────
returnRouter.patch('/:id', async (req, res) => {
  try {
    const { status, resolution_type, refund_amount, admin_notes, decided_by, item_updates } = req.body;

    // Get the current return request to check for status changes
    const current = await returnService.getReturnRequest(req.params.id);
    if (!current) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (status !== undefined) updates.status = status;
    if (resolution_type !== undefined) updates.resolution_type = resolution_type;
    if (refund_amount !== undefined) updates.refund_amount = refund_amount;
    if (admin_notes !== undefined) updates.admin_notes = admin_notes;
    if (decided_by !== undefined) updates.decided_by = decided_by;

    // Set decided_at if status is a decision status
    if (status && ['approved', 'denied', 'partially_approved'].includes(status) && !current.decided_at) {
      updates.decided_at = new Date().toISOString();
    }

    if (Object.keys(updates).length === 0 && (!item_updates || item_updates.length === 0)) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    // Update individual item statuses if provided
    if (item_updates && Array.isArray(item_updates)) {
      for (const itemUpdate of item_updates) {
        if (itemUpdate.id && itemUpdate.item_status) {
          await returnService.updateReturnItemStatus(
            itemUpdate.id,
            itemUpdate.item_status,
            itemUpdate.denial_reason,
          );
        }
      }
    }

    const updated = Object.keys(updates).length > 0
      ? await returnService.updateReturnRequest(
          req.params.id,
          updates as Parameters<typeof returnService.updateReturnRequest>[1],
        )
      : await returnService.getReturnRequest(req.params.id);

    if (!updated) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    // Send status-change emails
    if (status && status !== current.status) {
      const itemsSummary = (updated.items ?? [])
        .map((i) => `${i.product_title} (x${i.quantity})`)
        .join(', ');

      if (status === 'approved') {
        sendReturnApproved({
          to: updated.customer_email,
          customerName: updated.customer_name ?? undefined,
          returnRequestId: updated.id,
          orderNumber: updated.order_number,
          items: itemsSummary,
        }).catch((err) => console.error('[return.controller] Approval email failed:', err));
      }

      if (status === 'denied') {
        sendReturnDenied({
          to: updated.customer_email,
          customerName: updated.customer_name ?? undefined,
          returnRequestId: updated.id,
          orderNumber: updated.order_number,
          items: itemsSummary,
          reason: admin_notes ?? 'Your return request was not approved.',
        }).catch((err) => console.error('[return.controller] Denial email failed:', err));
      }

      if (status === 'refunded') {
        sendReturnRefunded({
          to: updated.customer_email,
          customerName: updated.customer_name ?? undefined,
          returnRequestId: updated.id,
          orderNumber: updated.order_number,
          items: itemsSummary,
          refundAmount: refund_amount ?? updated.refund_amount ?? undefined,
        }).catch((err) => console.error('[return.controller] Refund email failed:', err));
      }
    }

    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }
    console.error('[return.controller] PATCH /:id error:', message);
    res.status(500).json({ error: 'Failed to update return request' });
  }
});
