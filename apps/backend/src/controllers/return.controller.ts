import { Router } from 'express';
import { resolveBrandId } from '../config/brand.js';
import * as returnService from '../services/return.service.js';
import * as returnRulesService from '../services/return-rules.service.js';
import * as returnAIService from '../services/return-ai.service.js';
import {
  sendReturnConfirmation,
  sendReturnApproved,
  sendReturnApprovedNoReturn,
  sendReturnDenied,
  sendReturnRefunded,
} from '../services/email.service.js';
import { lookupOrder } from '../services/shopify-admin.service.js';
import { processRefund } from '../services/refund.service.js';
import * as returnSettingsService from '../services/return-settings.service.js';
import * as returnEmailTemplateService from '../services/return-email-template.service.js';
import { supabase } from '../config/supabase.js';
import * as shippoService from '../services/shippo.service.js';

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
    const { order_id, order_number, customer_email, customer_name, items, package_dimensions } = req.body;

    if (!order_id || !order_number || !customer_email || !items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'order_id, order_number, customer_email, and items are required' });
      return;
    }

    const brandId = await resolveBrandId(req);
    const settings = await returnSettingsService.getReturnSettings(brandId);

    // 1. Create return request (include package_dimensions if provided)
    const returnRequest = await returnService.createReturnRequest({
      brand_id: brandId,
      order_id,
      order_number,
      customer_email,
      customer_name,
      items,
      package_dimensions: package_dimensions || null,
    });

    // 1b. Estimate shipping cost if dimensions provided (fire-and-forget)
    if (package_dimensions && package_dimensions.length > 0 && package_dimensions.weight > 0) {
      (async () => {
        try {
          const orderResult = await lookupOrder(order_number, customer_email, undefined, brandId);
          if (orderResult.found && orderResult.order && orderResult.order.shippingZip) {
            const { getShippingEstimate } = await import('../services/shippo.service.js');
            const estimate = await getShippingEstimate({
              customerStreet1: orderResult.order.shippingAddress1 || undefined,
              customerCity: orderResult.order.shippingCity || '',
              customerState: orderResult.order.shippingProvince || '',
              customerZip: orderResult.order.shippingZip || '',
              customerCountry: orderResult.order.shippingCountry || 'US',
              length: package_dimensions.length,
              width: package_dimensions.width,
              height: package_dimensions.height,
              weight: package_dimensions.weight,
            });
            if (estimate.cheapestRate) {
              await supabase
                .from('return_requests')
                .update({
                  estimated_shipping_cost: estimate.cheapestRate,
                  estimated_return_warehouse: estimate.warehouse,
                })
                .eq('id', returnRequest.id);
              console.log(`[return.controller] Estimated shipping for ${order_number}: $${estimate.cheapestRate.toFixed(2)} to ${estimate.warehouse}`);
            }
          }
        } catch (err) {
          console.warn('[return.controller] Shipping estimate failed:', err instanceof Error ? err.message : err);
        }
      })();
    }

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
    const validTypes = ['confirmation', 'approved', 'approved_no_return', 'denied', 'refunded'];
    if (!validTypes.includes(req.params.type)) {
      res.status(400).json({ error: 'Invalid template type' });
      return;
    }
    const template = await returnEmailTemplateService.getTemplate(
      brandId,
      req.params.type as 'confirmation' | 'approved' | 'approved_no_return' | 'denied' | 'refunded',
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
    const validTypes = ['confirmation', 'approved', 'approved_no_return', 'denied', 'refunded'];
    if (!validTypes.includes(req.params.type)) {
      res.status(400).json({ error: 'Invalid template type' });
      return;
    }
    const updated = await returnEmailTemplateService.updateTemplate(
      brandId,
      req.params.type as 'confirmation' | 'approved' | 'approved_no_return' | 'denied' | 'refunded',
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
        restocking_fee_percent: settings.restocking_fee_percent ?? 20,
        restocking_fee_exempt_reasons: settings.restocking_fee_exempt_reasons ?? ['defective', 'wrong_item', 'not_as_described'],
        collect_dimensions_for_reasons: settings.collect_dimensions_for_reasons ?? ['defective', 'wrong_item', 'not_as_described'],
        provide_prepaid_label_for_reasons: settings.provide_prepaid_label_for_reasons ?? ['defective', 'wrong_item', 'not_as_described'],
        dimension_collection_enabled: settings.dimension_collection_enabled ?? true,
      },
      design,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET /portal-config error:', message);
    res.status(500).json({ error: 'Failed to get portal config' });
  }
});

// ── POST /:id/create-label — Create a return shipping label ──────────────
returnRouter.post('/:id/create-label', async (req, res) => {
  try {
    const returnRequest = await returnService.getReturnRequest(req.params.id);
    if (!returnRequest) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    if (returnRequest.status !== 'approved' && returnRequest.status !== 'partially_approved') {
      res.status(400).json({ error: 'Return must be approved before creating a label' });
      return;
    }

    const brandId = await resolveBrandId(req);

    const { customer_address, package_dimensions } = req.body as {
      customer_address: {
        name: string;
        street1: string;
        street2?: string;
        city: string;
        state: string;
        zip: string;
        country: string;
      };
      package_dimensions?: {
        length: number;
        width: number;
        height: number;
        weight: number;
        weight_unit?: string;
        dimension_unit?: string;
      };
    };

    if (!customer_address?.name || !customer_address?.street1 || !customer_address?.city ||
        !customer_address?.state || !customer_address?.zip || !customer_address?.country) {
      res.status(400).json({ error: 'customer_address with name, street1, city, state, zip, country is required' });
      return;
    }

    // Resolve package dimensions: use provided, else look up preset by first item's SKU
    let dims = package_dimensions ?? null;

    if (!dims) {
      const items = returnRequest.items ?? [];
      for (const item of items) {
        // Try to find a preset by matching product_title or sku stored in line item
        // The line_item_id or variant_title may contain the SKU — try product_title as fallback key
        const skuCandidate = item.variant_title ?? item.product_title;
        if (skuCandidate) {
          const preset = await shippoService.getPresetDimensions(skuCandidate, brandId);
          if (preset) {
            dims = preset;
            break;
          }
        }
      }
    }

    if (!dims) {
      res.status(400).json({
        error: 'No package dimensions provided and no preset found for this SKU. Please provide package_dimensions.',
      });
      return;
    }

    const result = await shippoService.createReturnLabel({
      customerName: customer_address.name,
      customerStreet1: customer_address.street1,
      customerStreet2: customer_address.street2,
      customerCity: customer_address.city,
      customerState: customer_address.state,
      customerZip: customer_address.zip,
      customerCountry: customer_address.country,
      customerEmail: returnRequest.customer_email,
      length: dims.length,
      width: dims.width,
      height: dims.height,
      weight: dims.weight,
      weightUnit: dims.weight_unit ?? 'lb',
      dimensionUnit: dims.dimension_unit ?? 'in',
    });

    if (!result.success) {
      res.status(502).json({ error: result.error ?? 'Failed to create shipping label' });
      return;
    }

    // Store label info on the return request
    const { error: updateError } = await supabase
      .from('return_requests')
      .update({
        return_label_url: result.labelUrl,
        return_tracking_number: result.trackingNumber,
        return_carrier: result.carrier,
        return_shipping_cost: result.rate ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    if (updateError) {
      console.error('[return.controller] Failed to store label info:', updateError.message);
    }

    res.json({
      labelUrl: result.labelUrl,
      trackingNumber: result.trackingNumber,
      trackingUrl: result.trackingUrl,
      carrier: result.carrier,
      rate: result.rate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] POST /:id/create-label error:', message);
    res.status(500).json({ error: 'Failed to create return label' });
  }
});

// ── POST /:id/approve — Approve Return (with shipping expected) ──────────
returnRouter.post('/:id/approve', async (req, res) => {
  try {
    const current = await returnService.getReturnRequest(req.params.id);
    if (!current) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    const brandId = await resolveBrandId(req);
    const settings = await returnSettingsService.getReturnSettings(brandId);
    const { resolution_type, refund_amount, admin_notes } = req.body;

    const updated = await returnService.updateReturnRequest(req.params.id, {
      status: 'approved',
      resolution_type: resolution_type ?? 'refund',
      refund_amount: refund_amount ?? null,
      admin_notes: admin_notes ?? current.admin_notes ?? null,
      decided_at: new Date().toISOString(),
      decided_by: req.body.decided_by ?? 'admin',
    });

    const itemsSummary = (updated.items ?? [])
      .map((i) => `${i.product_title} (x${i.quantity})`)
      .join(', ');

    // Auto-create prepaid return label
    let labelUrl: string | null = null;
    let labelTrackingNumber: string | null = null;

    const returnReason = updated.items?.[0]?.reason;
    const prepaidReasons = settings.provide_prepaid_label_for_reasons ?? ['defective', 'wrong_item', 'not_as_described'];
    const qualifiesForPrepaid = returnReason && prepaidReasons.includes(returnReason);

    // Get dimensions from return request, or use defaults
    let dims = updated.package_dimensions as Record<string, number> | null;
    if (!dims || !dims.length || !dims.weight) {
      // Default package dimensions if customer didn't provide
      dims = { length: 24, width: 18, height: 12, weight: 10 };
      console.log(`[return.controller] No customer dimensions, using defaults: 24x18x12, 10lbs`);
    }

    console.log(`[return.controller] Label check: reason=${returnReason}, qualifies=${qualifiesForPrepaid}, dims=${JSON.stringify(dims)}`);

    if (qualifiesForPrepaid) {
      try {
        // Get customer's FULL shipping address from Shopify
        const orderResult = await lookupOrder(updated.order_number, undefined, undefined, brandId, true);

        if (orderResult.found && orderResult.order) {
          const order = orderResult.order;
          console.log(`[return.controller] Shopify address: ${order.shippingAddress1}, ${order.shippingCity}, ${order.shippingProvince} ${order.shippingZip}, ${order.shippingCountry}`);

          const { createReturnLabel } = await import('../services/shippo.service.js');
          const labelResult = await createReturnLabel({
            customerName: updated.customer_name || orderResult.customerEmail || 'Customer',
            customerStreet1: order.shippingAddress1 || '',
            customerCity: order.shippingCity || '',
            customerState: order.shippingProvince || '',
            customerZip: order.shippingZip || '',
            customerCountry: order.shippingCountry || 'US',
            length: dims.length,
            width: dims.width,
            height: dims.height,
            weight: dims.weight,
          });

          if (labelResult.success) {
            labelUrl = labelResult.labelUrl ?? null;
            labelTrackingNumber = labelResult.trackingNumber ?? null;

            await returnService.updateReturnRequest(req.params.id, {
              return_label_url: labelUrl,
              return_tracking_number: labelTrackingNumber,
              return_carrier: labelResult.carrier ?? null,
              return_shipping_cost: labelResult.rate ?? null,
            });

            console.log(`[return.controller] Auto-label created: ${labelTrackingNumber}, carrier: ${labelResult.carrier}, cost: $${labelResult.rate}`);
          } else {
            console.error(`[return.controller] Auto-label FAILED: ${labelResult.error}`);
          }
        } else {
          console.error(`[return.controller] Shopify order lookup failed for ${updated.order_number}`);
        }
      } catch (labelErr) {
        console.error('[return.controller] Auto-label creation error:', labelErr instanceof Error ? labelErr.message : labelErr);
      }
    }

    sendReturnApproved({
      to: updated.customer_email,
      customerName: updated.customer_name ?? undefined,
      returnRequestId: updated.id,
      orderNumber: updated.order_number,
      items: itemsSummary,
      labelUrl: labelUrl ?? undefined,
      trackingNumber: labelTrackingNumber ?? undefined,
      brandId,
    }).catch((err) => console.error('[return.controller] Approval email failed:', err));

    res.json({ returnRequest: updated, label: labelUrl ? { url: labelUrl, trackingNumber: labelTrackingNumber } : null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] POST /:id/approve error:', message);
    res.status(500).json({ error: 'Failed to approve return request' });
  }
});

// ── POST /:id/approve-no-return — Approve & Refund Only (no shipping) ───
returnRouter.post('/:id/approve-no-return', async (req, res) => {
  try {
    const current = await returnService.getReturnRequest(req.params.id);
    if (!current) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    const brandId = await resolveBrandId(req);
    const settings = await returnSettingsService.getReturnSettings(brandId);

    // Determine return reason from items for restocking fee exemption
    const returnReason = current.items?.[0]?.reason ?? undefined;

    // Process refund through Shopify immediately
    let refundResult: { success: boolean; refundId?: string; amount?: number; error?: string } = {
      success: false,
      error: 'Refund not attempted',
    };

    try {
      refundResult = await processRefund({
        orderNumber: current.order_number,
        brandId,
        restockingFeePercent: settings.restocking_fee_percent ?? 20,
        exemptReasons: settings.restocking_fee_exempt_reasons ?? ['defective', 'wrong_item', 'not_as_described'],
        returnReason,
        dryRun: false,
      });
    } catch (err) {
      console.error('[return.controller] Shopify refund failed:', err instanceof Error ? err.message : err);
      refundResult = { success: false, error: err instanceof Error ? err.message : 'Refund processing failed' };
    }

    if (!refundResult.success) {
      // Still approve the request but don't mark as refunded
      const updated = await returnService.updateReturnRequest(req.params.id, {
        status: 'approved',
        approved_no_return: true,
        resolution_type: 'refund',
        admin_notes: `${current.admin_notes ? current.admin_notes + '\n' : ''}Approve-no-return: Shopify refund failed — ${refundResult.error}`,
        decided_at: new Date().toISOString(),
        decided_by: req.body.decided_by ?? 'admin',
      });
      res.status(207).json({
        returnRequest: updated,
        refund: { success: false, error: refundResult.error },
      });
      return;
    }

    // Refund succeeded — mark as refunded
    const updated = await returnService.updateReturnRequest(req.params.id, {
      status: 'refunded',
      approved_no_return: true,
      resolution_type: 'refund',
      refund_amount: refundResult.amount ?? null,
      shopify_return_id: refundResult.refundId ?? null,
      decided_at: new Date().toISOString(),
      decided_by: req.body.decided_by ?? 'admin',
    });

    const itemsSummary = (updated.items ?? [])
      .map((i) => `${i.product_title} (x${i.quantity})`)
      .join(', ');

    sendReturnApprovedNoReturn({
      to: updated.customer_email,
      customerName: updated.customer_name ?? undefined,
      returnRequestId: updated.id,
      orderNumber: updated.order_number,
      items: itemsSummary,
      refundAmount: refundResult.amount,
      brandId,
    }).catch((err) => console.error('[return.controller] Approved-no-return email failed:', err));

    res.json({
      returnRequest: updated,
      refund: { success: true, refundId: refundResult.refundId, amount: refundResult.amount },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] POST /:id/approve-no-return error:', message);
    res.status(500).json({ error: 'Failed to process approve-no-return' });
  }
});

// ── POST /:id/deny — Deny Return with Reason ─────────────────────────────
returnRouter.post('/:id/deny', async (req, res) => {
  try {
    const current = await returnService.getReturnRequest(req.params.id);
    if (!current) {
      res.status(404).json({ error: 'Return request not found' });
      return;
    }

    const { denial_reason, admin_notes } = req.body;
    if (!denial_reason) {
      res.status(400).json({ error: 'denial_reason is required' });
      return;
    }

    const brandId = await resolveBrandId(req);

    const updated = await returnService.updateReturnRequest(req.params.id, {
      status: 'denied',
      denial_reason,
      admin_notes: admin_notes ?? current.admin_notes ?? null,
      decided_at: new Date().toISOString(),
      decided_by: req.body.decided_by ?? 'admin',
    });

    const itemsSummary = (updated.items ?? [])
      .map((i) => `${i.product_title} (x${i.quantity})`)
      .join(', ');

    sendReturnDenied({
      to: updated.customer_email,
      customerName: updated.customer_name ?? undefined,
      returnRequestId: updated.id,
      orderNumber: updated.order_number,
      items: itemsSummary,
      reason: denial_reason,
      brandId,
    }).catch((err) => console.error('[return.controller] Denial email failed:', err));

    res.json({ returnRequest: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] POST /:id/deny error:', message);
    res.status(500).json({ error: 'Failed to deny return request' });
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

// ── GET /label-presets — List all label presets for the brand ────────────
returnRouter.get('/label-presets', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { data, error } = await supabase
      .from('label_presets')
      .select('*')
      .eq('brand_id', brandId)
      .order('sku', { ascending: true });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ presets: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] GET /label-presets error:', message);
    res.status(500).json({ error: 'Failed to list label presets' });
  }
});

// ── POST /label-presets — Create or update a label preset ────────────────
returnRouter.post('/label-presets', async (req, res) => {
  try {
    const { sku, product_title, length, width, height, weight, weight_unit, dimension_unit } = req.body;

    if (!sku || length == null || width == null || height == null || weight == null) {
      res.status(400).json({ error: 'sku, length, width, height, and weight are required' });
      return;
    }

    const brandId = await resolveBrandId(req);

    const { data, error } = await supabase
      .from('label_presets')
      .upsert(
        {
          brand_id: brandId,
          sku,
          product_title: product_title ?? null,
          length,
          width,
          height,
          weight,
          weight_unit: weight_unit ?? 'lb',
          dimension_unit: dimension_unit ?? 'in',
        },
        { onConflict: 'brand_id,sku' }
      )
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({ preset: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] POST /label-presets error:', message);
    res.status(500).json({ error: 'Failed to create label preset' });
  }
});

// ── DELETE /label-presets/:sku — Delete a preset ─────────────────────────
returnRouter.delete('/label-presets/:sku', async (req, res) => {
  try {
    const brandId = await resolveBrandId(req);
    const { error } = await supabase
      .from('label_presets')
      .delete()
      .eq('brand_id', brandId)
      .eq('sku', req.params.sku);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[return.controller] DELETE /label-presets/:sku error:', message);
    res.status(500).json({ error: 'Failed to delete label preset' });
  }
});

// ── PATCH /:id — Update Return Request ───────────────────────────────────
returnRouter.patch('/:id', async (req, res) => {
  try {
    const { status, resolution_type, refund_amount, admin_notes, denial_reason, decided_by, item_updates } = req.body;

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
    if (denial_reason !== undefined) updates.denial_reason = denial_reason;
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
          reason: denial_reason ?? admin_notes ?? 'Your return request was not approved.',
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
