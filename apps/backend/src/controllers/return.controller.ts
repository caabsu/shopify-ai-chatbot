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
import * as returnSettingsService from '../services/return-settings.service.js';
import * as returnEmailTemplateService from '../services/return-email-template.service.js';
import { supabase } from '../config/supabase.js';

export const returnRouter = Router();

// ── POST /upload — Upload Return Image ───────────────────────────────────
returnRouter.post('/upload', async (req, res) => {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.startsWith('image/')) {
      res.status(400).json({ error: 'Content-Type must be an image type (image/jpeg, image/png, etc.)' });
      return;
    }

    const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const filePath = `uploads/${filename}`;

    // Collect raw body chunks
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const body = Buffer.concat(chunks);

    if (body.length === 0) {
      res.status(400).json({ error: 'Empty file' });
      return;
    }

    if (body.length > 10 * 1024 * 1024) {
      res.status(400).json({ error: 'File too large (max 10MB)' });
      return;
    }

    const { error } = await supabase.storage
      .from('return-images')
      .upload(filePath, body, { contentType, upsert: false });

    if (error) {
      console.error('[return.controller] Storage upload error:', error.message);
      res.status(500).json({ error: 'Failed to upload image' });
      return;
    }

    const { data: urlData } = supabase.storage
      .from('return-images')
      .getPublicUrl(filePath);

    res.json({ url: urlData.publicUrl, path: filePath });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] POST /upload error:', message);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// ── POST /submit — Customer Submits a Return Request ─────────────────────
returnRouter.post('/submit', async (req, res) => {
  try {
    const { order_id, order_number, customer_email, customer_name, items } = req.body;

    if (!order_id || !order_number || !customer_email || !items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'order_id, order_number, customer_email, and items are required' });
      return;
    }

    const brandId = await resolveBrandId(req);
    const settings = await returnSettingsService.getReturnSettings(brandId);

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
        brandId,
      }).catch((err) => console.error('[return.controller] Confirmation email failed:', err));

      sendReturnApproved({
        to: customer_email,
        customerName: customer_name,
        returnRequestId: returnRequest.id,
        orderNumber: order_number,
        items: itemsSummary,
        brandId,
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
        brandId,
      }).catch((err) => console.error('[return.controller] Confirmation email failed:', err));

      sendReturnDenied({
        to: customer_email,
        customerName: customer_name,
        returnRequestId: returnRequest.id,
        orderNumber: order_number,
        items: itemsSummary,
        reason: 'Your return request does not meet our return policy requirements.',
        brandId,
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
      if (aiRecommendation.confidence >= settings.ai_confidence_threshold && aiRecommendation.decision === 'approve') {
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
          brandId,
        }).catch((err) => console.error('[return.controller] Confirmation email failed:', err));

        sendReturnApproved({
          to: customer_email,
          customerName: customer_name,
          returnRequestId: returnRequest.id,
          orderNumber: order_number,
          items: itemsSummary,
          brandId,
        }).catch((err) => console.error('[return.controller] Approval email failed:', err));

        res.status(201).json({ return_request: updated, status: 'approved' });
        return;
      }

      if (aiRecommendation.confidence >= settings.ai_confidence_threshold && aiRecommendation.decision === 'deny') {
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
          brandId,
        }).catch((err) => console.error('[return.controller] Confirmation email failed:', err));

        sendReturnDenied({
          to: customer_email,
          customerName: customer_name,
          returnRequestId: returnRequest.id,
          orderNumber: order_number,
          items: itemsSummary,
          reason: aiRecommendation.reasoning,
          brandId,
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
        brandId,
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
      brandId,
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

// ── GET /settings — Return Settings ─────────────────────────────────────
returnRouter.get('/settings', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const settings = await returnSettingsService.getReturnSettings(brandId);
    res.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET /settings error:', message);
    res.status(500).json({ error: 'Failed to get return settings' });
  }
});

// ── PUT /settings — Update Return Settings ──────────────────────────────
returnRouter.put('/settings', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const updated = await returnSettingsService.updateReturnSettings(brandId, req.body);
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] PUT /settings error:', message);
    res.status(500).json({ error: 'Failed to update return settings' });
  }
});

// ── GET /emails — List All Email Templates ──────────────────────────────
returnRouter.get('/emails', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const templates = await returnEmailTemplateService.getTemplates(brandId);
    res.json({ templates });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET /emails error:', message);
    res.status(500).json({ error: 'Failed to list email templates' });
  }
});

// ── GET /emails/:type — Single Email Template ───────────────────────────
returnRouter.get('/emails/:type', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const validTypes = ['confirmation', 'approved', 'denied', 'refunded'];
    if (!validTypes.includes(req.params.type)) {
      res.status(400).json({ error: 'Invalid template type' });
      return;
    }
    const template = await returnEmailTemplateService.getTemplate(
      brandId,
      req.params.type as 'confirmation' | 'approved' | 'denied' | 'refunded',
    );
    if (!template) {
      res.status(404).json({ error: 'Template not found' });
      return;
    }
    res.json(template);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET /emails/:type error:', message);
    res.status(500).json({ error: 'Failed to get email template' });
  }
});

// ── PUT /emails/:type — Update Email Template ───────────────────────────
returnRouter.put('/emails/:type', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const validTypes = ['confirmation', 'approved', 'denied', 'refunded'];
    if (!validTypes.includes(req.params.type)) {
      res.status(400).json({ error: 'Invalid template type' });
      return;
    }
    const updated = await returnEmailTemplateService.updateTemplate(
      brandId,
      req.params.type as 'confirmation' | 'approved' | 'denied' | 'refunded',
      req.body,
    );
    res.json(updated);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] PUT /emails/:type error:', message);
    res.status(500).json({ error: 'Failed to update email template' });
  }
});

// ── GET /portal-design — Portal Design Config ───────────────────────────
returnRouter.get('/portal-design', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { data, error } = await supabase
      .from('ai_config')
      .select('value')
      .eq('brand_id', brandId)
      .eq('key', 'return_portal_design')
      .single();

    if (error && error.code !== 'PGRST116') {
      res.status(500).json({ error: error.message });
      return;
    }

    let design = null;
    if (data?.value) {
      try { design = JSON.parse(data.value); } catch { /* ignore */ }
    }

    res.json({ design });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET /portal-design error:', message);
    res.status(500).json({ error: 'Failed to get portal design' });
  }
});

// ── PUT /portal-design — Update Portal Design ───────────────────────────
returnRouter.put('/portal-design', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { error } = await supabase
      .from('ai_config')
      .upsert(
        {
          brand_id: brandId,
          key: 'return_portal_design',
          value: JSON.stringify(req.body),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'brand_id,key' },
      );

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] PUT /portal-design error:', message);
    res.status(500).json({ error: 'Failed to update portal design' });
  }
});

// ── GET /portal-config — Public endpoint for widget ─────────────────────
returnRouter.get('/portal-config', async (req, res) => {
  // Allow short browser caching to avoid repeated fetches on page loads
  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  try {
    const brandId = await resolveBrandId(req);
    const [settings, designRow] = await Promise.all([
      returnSettingsService.getReturnSettings(brandId),
      supabase
        .from('ai_config')
        .select('value')
        .eq('brand_id', brandId)
        .eq('key', 'return_portal_design')
        .single(),
    ]);

    let design = null;
    if (designRow.data?.value) {
      try { design = JSON.parse(designRow.data.value); } catch { /* ignore */ }
    }

    res.json({
      settings: {
        return_window_days: settings.return_window_days,
        require_photos: settings.require_photos,
        require_photos_for_reasons: settings.require_photos_for_reasons || [],
        available_reasons: settings.available_reasons,
        reason_labels: settings.reason_labels,
        available_resolutions: settings.available_resolutions,
        portal_title: settings.portal_title,
        portal_description: settings.portal_description,
      },
      design,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET /portal-config error:', message);
    res.status(500).json({ error: 'Failed to get portal config' });
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
      const brandId = await resolveBrandId(req);
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
          brandId,
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
          brandId,
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
          brandId,
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
