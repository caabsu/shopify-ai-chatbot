import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import * as jose from 'jose';
import { resolveBrandId } from '../config/brand.js';
import { getBrandShopifyConfig } from '../config/brand-shopify.js';
import { supabase } from '../config/supabase.js';
import { agentAuthMiddleware } from '../middleware/agent-auth.middleware.js';
import * as tradeService from '../services/trade.service.js';
import { evaluateAutoApproveRules, processApproval, processRejection, processSuspension, processReactivation } from '../services/trade-approval.service.js';
import { sendTradeApplicationReceivedEmail } from '../services/trade-email.service.js';
import { findCustomerByEmail } from '../services/trade-shopify.service.js';
import { graphql as shopifyGraphql } from '../services/shopify-admin.service.js';
import { createTicket, addTicketMessage } from '../services/ticket.service.js';
import { v4 as uuidv4 } from 'uuid';

// ========== PORTAL AUTH ==========

const PORTAL_JWT_SECRET = new TextEncoder().encode(
  process.env.TRADE_PORTAL_JWT_SECRET || 'portal-secret-key-change-me'
);

export interface PortalMemberPayload {
  member_id: string;
  customer_id: string;
  email: string;
  company_name: string;
  brand_id: string;
}

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      portalMember?: PortalMemberPayload;
    }
  }
}

export async function signPortalToken(payload: PortalMemberPayload): Promise<string> {
  return new jose.SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .setIssuedAt()
    .sign(PORTAL_JWT_SECRET);
}

export async function portalAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let token: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    if (!token) {
      const cookieHeader = req.headers.cookie;
      if (cookieHeader) {
        const parsed = cookieHeader.split(';').reduce<Record<string, string>>((acc, c) => {
          const [key, val] = c.trim().split('=');
          if (key && val) acc[key] = decodeURIComponent(val);
          return acc;
        }, {});
        token = parsed['portal_session'];
      }
    }

    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { payload } = await jose.jwtVerify(token, PORTAL_JWT_SECRET);

    req.portalMember = {
      member_id: payload.member_id as string,
      customer_id: payload.customer_id as string,
      email: payload.email as string,
      company_name: payload.company_name as string,
      brand_id: payload.brand_id as string,
    };

    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[portal-auth] Token verification failed:', message);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export const tradeRouter = Router();

// Rate limiters
const applyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Too many applications. Try again later.' } });
const statusLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many requests. Try again later.' } });

// CSRF validation for public endpoints
function validateOrigin(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const allowedDomains = ['outlight.com', 'www.outlight.com', 'outlight.us', 'www.outlight.us', 'put1rp-iq.myshopify.com', 'localhost'];
  const isAllowed = allowedDomains.some((d) => origin.includes(d) || referer.includes(d));
  if (!isAllowed && origin !== '') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

// ========== DIAGNOSTIC (temporary) ==========
tradeRouter.get('/debug/setup-b2b-catalog', async (req: Request, res: Response) => {
  try {
    const brandId = await resolveBrandId(req);

    // Step 1: Create a new CompanyLocationCatalog for B2B
    const createResult = await shopifyGraphql<any>(
      `mutation catalogCreate($input: CatalogCreateInput!) {
        catalogCreate(input: $input) {
          catalog { id title status }
          userErrors { field message }
        }
      }`,
      {
        input: {
          title: 'Trade Program B2B',
          status: 'ACTIVE',
          context: {
            companyLocationIds: [],
          },
        },
      },
      brandId
    );

    if (createResult.catalogCreate.userErrors.length > 0) {
      res.status(400).json({ error: createResult.catalogCreate.userErrors });
      return;
    }

    const newCatalogId = createResult.catalogCreate.catalog.id;

    // Step 3: Create a price list with -30% adjustment for the new catalog
    const priceListResult = await shopifyGraphql<any>(
      `mutation priceListCreate($input: PriceListCreateInput!) {
        priceListCreate(input: $input) {
          priceList { id name }
          userErrors { field message }
        }
      }`,
      {
        input: {
          name: 'Trade Program -30%',
          currency: 'USD',
          parent: {
            adjustment: {
              type: 'PERCENTAGE_DECREASE',
              value: 30,
            },
          },
          catalogId: newCatalogId,
        },
      },
      brandId
    );

    res.json({
      newCatalog: createResult.catalogCreate.catalog,
      priceList: priceListResult.priceListCreate,
      message: `Update trade_settings.metadata.shopify_catalog_id to: ${newCatalogId}`,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ========== PUBLIC ROUTES ==========

// POST /api/trade/apply
tradeRouter.post('/apply', validateOrigin, applyLimiter, async (req: Request, res: Response) => {
  try {
    const brandId = await resolveBrandId(req);
    const { full_name, email, phone, company_name, business_type, website_url, project_description, referral_source, _honeypot } = req.body;

    // Honeypot check
    if (_honeypot) {
      res.json({ success: true, status: 'pending', message: 'Application received.' });
      return;
    }

    // Validate required fields
    if (!full_name || !email || !company_name || !business_type || !website_url) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const validTypes = ['interior_designer', 'architect', 'contractor', 'hospitality', 'developer', 'other'];
    if (!validTypes.includes(business_type)) {
      res.status(400).json({ error: 'Invalid business type' });
      return;
    }

    // Check for existing Shopify customer (don't create yet)
    let shopifyCustomerId: string | undefined;
    try {
      const existing = await findCustomerByEmail(email, brandId);
      if (existing) {
        shopifyCustomerId = existing.id;
        // Check if already a trade member
        if (existing.tags.includes('trade-program')) {
          res.status(409).json({ error: 'You are already a trade program member' });
          return;
        }
      }
    } catch (err) {
      console.error('[trade.controller] Shopify lookup failed:', err);
      // Non-fatal — proceed without Shopify ID
    }

    // Generate status token for status checking
    const statusToken = uuidv4();

    // Create application
    const application = await tradeService.createApplication({
      brand_id: brandId,
      full_name,
      email,
      phone,
      company_name,
      business_type,
      website_url,
      project_description,
      referral_source,
      shopify_customer_id: shopifyCustomerId,
      metadata: { status_token: statusToken },
    });

    // Evaluate auto-approve rules
    const settings = await tradeService.getTradeSettings(brandId);
    const shouldAutoApprove = evaluateAutoApproveRules(application, settings);

    if (shouldAutoApprove) {
      try {
        await processApproval(application, {
          brandId,
          actorType: 'system',
        });
        res.status(201).json({
          success: true,
          status: 'approved',
          message: 'Your application has been approved. Check your email for details.',
        });
        return;
      } catch (approvalErr) {
        console.error('[trade.controller] Auto-approval failed, falling back to manual review:', approvalErr instanceof Error ? approvalErr.message : approvalErr);
        // Fall through to pending response — application is saved, admin can approve manually
      }
    }

    // Send confirmation email
    sendTradeApplicationReceivedEmail({
      to: email,
      full_name,
      company_name,
      brandId,
    }).catch((err) => console.error('[trade.controller] Confirmation email failed:', err));

    res.status(201).json({
      success: true,
      status: 'pending',
      message: 'Application received. We will review it within 1-2 business days.',
      status_token: statusToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[trade.controller] POST /apply error:', message);

    if (message.includes('already pending or approved')) {
      res.status(409).json({ error: message });
      return;
    }
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// POST /api/trade/status
tradeRouter.post('/status', validateOrigin, statusLimiter, async (req: Request, res: Response) => {
  try {
    const { email, token } = req.body;
    if (!email || !token) {
      res.status(400).json({ error: 'Email and token required' });
      return;
    }

    const brandId = await resolveBrandId(req);

    // Exact query by email and status token (not fuzzy search)
    const { data: app, error } = await supabase
      .from('trade_applications')
      .select('status')
      .eq('brand_id', brandId)
      .eq('email', email.toLowerCase().trim())
      .eq('metadata->>status_token', token)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !app) {
      res.json({ status: 'not_found' });
      return;
    }

    res.json({ status: app.status });
  } catch (err) {
    console.error('[trade.controller] POST /status error:', err);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// ========== ADMIN ROUTES (agent auth) ==========

// GET /api/trade/applications
tradeRouter.get('/applications', agentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const brandId = req.agent!.brandId;
    const { status, business_type, search, page, limit, sort, order } = req.query;

    const result = await tradeService.listApplications({
      brand_id: brandId,
      status: status as string,
      business_type: business_type as string,
      search: search as string,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      sort: sort as string,
      order: order as 'asc' | 'desc',
    });

    // Get counts per status
    const [pendingCount, approvedCount, rejectedCount] = await Promise.all([
      tradeService.listApplications({ brand_id: brandId, status: 'pending', limit: 0 }),
      tradeService.listApplications({ brand_id: brandId, status: 'approved', limit: 0 }),
      tradeService.listApplications({ brand_id: brandId, status: 'rejected', limit: 0 }),
    ]);

    res.json({
      ...result,
      counts: {
        pending: pendingCount.total,
        approved: approvedCount.total,
        rejected: rejectedCount.total,
        all: pendingCount.total + approvedCount.total + rejectedCount.total,
      },
    });
  } catch (err) {
    console.error('[trade.controller] GET /applications error:', err);
    res.status(500).json({ error: 'Failed to list applications' });
  }
});

// GET /api/trade/applications/:id
tradeRouter.get('/applications/:id', agentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const app = await tradeService.getApplication(req.params.id as string);
    if (!app) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }

    const activityLog = await tradeService.getActivityLog({
      brand_id: req.agent!.brandId,
      application_id: app.id,
    });

    res.json({ application: app, activity_log: activityLog });
  } catch (err) {
    console.error('[trade.controller] GET /applications/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch application' });
  }
});

// POST /api/trade/applications/:id/approve
tradeRouter.post('/applications/:id/approve', agentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const app = await tradeService.getApplication(req.params.id as string);
    if (!app) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    if (app.status !== 'pending') {
      res.status(400).json({ error: `Application is already ${app.status}` });
      return;
    }

    const { payment_terms, notes } = req.body;

    await processApproval(app, {
      brandId: req.agent!.brandId,
      payment_terms,
      notes,
      actorId: req.agent!.id,
      actorType: 'agent',
    });

    res.json({ success: true, message: 'Application approved' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[trade.controller] POST /applications/:id/approve error:', message);
    res.status(500).json({ error: 'Failed to approve application', detail: message });
  }
});

// POST /api/trade/applications/:id/reject
tradeRouter.post('/applications/:id/reject', agentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const app = await tradeService.getApplication(req.params.id as string);
    if (!app) {
      res.status(404).json({ error: 'Application not found' });
      return;
    }
    if (app.status !== 'pending') {
      res.status(400).json({ error: `Application is already ${app.status}` });
      return;
    }

    const { reason } = req.body;
    if (!reason) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }

    await processRejection(app, {
      brandId: req.agent!.brandId,
      reason,
      actorId: req.agent!.id,
    });

    res.json({ success: true, message: 'Application rejected' });
  } catch (err) {
    console.error('[trade.controller] POST /applications/:id/reject error:', err);
    res.status(500).json({ error: 'Failed to reject application' });
  }
});

// GET /api/trade/members
tradeRouter.get('/members', agentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const brandId = req.agent!.brandId;
    const { status, business_type, search, page, limit, sort, order } = req.query;

    const result = await tradeService.listMembers({
      brand_id: brandId,
      status: status as string,
      business_type: business_type as string,
      search: search as string,
      page: page ? parseInt(page as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      sort: sort as string,
      order: order as 'asc' | 'desc',
    });

    res.json(result);
  } catch (err) {
    console.error('[trade.controller] GET /members error:', err);
    res.status(500).json({ error: 'Failed to list members' });
  }
});

// GET /api/trade/members/:id
tradeRouter.get('/members/:id', agentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const member = await tradeService.getMember(req.params.id as string);
    if (!member) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    const activityLog = await tradeService.getActivityLog({
      brand_id: req.agent!.brandId,
      member_id: member.id,
    });

    res.json({ member, activity_log: activityLog });
  } catch (err) {
    console.error('[trade.controller] GET /members/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch member' });
  }
});

// PATCH /api/trade/members/:id
tradeRouter.patch('/members/:id', agentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const member = await tradeService.getMember(req.params.id as string);
    if (!member) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    const { status, payment_terms, notes } = req.body;

    // Handle status transitions
    if (status && status !== member.status) {
      if (status === 'suspended' && member.status === 'active') {
        await processSuspension(member.id, { brandId: req.agent!.brandId, actorId: req.agent!.id });
      } else if (status === 'revoked' && (member.status === 'active' || member.status === 'suspended')) {
        await processSuspension(member.id, { brandId: req.agent!.brandId, actorId: req.agent!.id });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await tradeService.updateMember(member.id, { status: 'revoked' } as any);
      } else if (status === 'active' && member.status === 'suspended') {
        await processReactivation(member.id, { brandId: req.agent!.brandId, actorId: req.agent!.id });
      } else {
        res.status(400).json({ error: `Cannot transition from ${member.status} to ${status}` });
        return;
      }
    }

    // Handle other updates
    const otherUpdates: Record<string, unknown> = {};
    if (payment_terms) otherUpdates.payment_terms = payment_terms;
    if (notes !== undefined) otherUpdates.notes = notes;

    if (Object.keys(otherUpdates).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await tradeService.updateMember(member.id, otherUpdates as any, req.agent!.id);
    }

    const updated = await tradeService.getMember(member.id);
    res.json({ member: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[trade.controller] PATCH /members/:id error:', message);
    res.status(500).json({ error: 'Failed to update member' });
  }
});

// GET /api/trade/settings
tradeRouter.get('/settings', agentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const settings = await tradeService.getTradeSettings(req.agent!.brandId);
    res.json({ settings });
  } catch (err) {
    console.error('[trade.controller] GET /settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PATCH /api/trade/settings
tradeRouter.patch('/settings', agentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const settings = await tradeService.updateTradeSettings(
      req.agent!.brandId,
      req.body,
      req.agent!.id
    );
    res.json({ settings });
  } catch (err) {
    console.error('[trade.controller] PATCH /settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// GET /api/trade/analytics
tradeRouter.get('/analytics', agentAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || '30d';
    const analytics = await tradeService.getTradeAnalytics(req.agent!.brandId, period);
    res.json(analytics);
  } catch (err) {
    console.error('[trade.controller] GET /analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// ========== PORTAL ROUTES ==========

// POST /api/trade/portal/auth/verify
tradeRouter.post('/portal/auth/verify', async (req: Request, res: Response) => {
  try {
    // The portal callback decodes the Shopify id_token (JWT) to extract the email,
    // then sends it here. The portal already authenticated the customer via Shopify OAuth,
    // so we trust the email. We just need to verify they're a trade member.
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email required' });
      return;
    }

    const brandId = await resolveBrandId(req);
    if (!email) {
      res.status(401).json({ error: 'Could not resolve customer email' });
      return;
    }

    // Look up trade member
    const member = await tradeService.getMemberByEmail(email, brandId);
    if (!member) {
      res.status(403).json({ error: 'Not a trade program member', code: 'NOT_MEMBER' });
      return;
    }
    if (member.status === 'suspended') {
      res.status(403).json({ error: 'Trade account suspended', code: 'SUSPENDED' });
      return;
    }
    if (member.status === 'revoked') {
      res.status(403).json({ error: 'Trade account revoked', code: 'REVOKED' });
      return;
    }

    // Issue portal session JWT
    const portalToken = await signPortalToken({
      member_id: member.id,
      customer_id: member.shopify_customer_id,
      email: member.email,
      company_name: member.company_name,
      brand_id: brandId,
    });

    res.json({ token: portalToken, member });
  } catch (err) {
    console.error('[trade.controller] POST /portal/auth/verify error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// GET /api/trade/portal/me
tradeRouter.get('/portal/me', portalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const member = await tradeService.getMember(req.portalMember!.member_id);
    if (!member) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    const settings = await tradeService.getTradeSettings(req.portalMember!.brand_id);
    res.json({ member, discount_code: settings.discount_code });
  } catch (err) {
    console.error('[trade.controller] GET /portal/me error:', err);
    res.status(500).json({ error: 'Failed to fetch member profile' });
  }
});

// GET /api/trade/portal/orders
tradeRouter.get('/portal/orders', portalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const member = await tradeService.getMember(req.portalMember!.member_id);
    if (!member) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    const data = await shopifyGraphql<{
      orders: { edges: Array<{ node: Record<string, unknown> }> };
    }>(
      `query($query: String!) {
        orders(first: 50, query: $query, sortKey: CREATED_AT, reverse: true) {
          edges { node {
            id name createdAt totalPriceSet { shopMoney { amount currencyCode } }
            displayFulfillmentStatus displayFinancialStatus
            lineItems(first: 10) { edges { node { title quantity } } }
          } }
        }
      }`,
      { query: `email:${member.email}` },
      req.portalMember!.brand_id
    );

    const orders = data.orders.edges.map((e) => e.node);
    res.json({ orders });
  } catch (err) {
    console.error('[trade.controller] GET /portal/orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// GET /api/trade/portal/resources
tradeRouter.get('/portal/resources', portalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const settings = await tradeService.getTradeSettings(req.portalMember!.brand_id);
    const resources = (settings.metadata as Record<string, unknown>)?.resources || [];
    res.json({ resources });
  } catch (err) {
    console.error('[trade.controller] GET /portal/resources error:', err);
    res.status(500).json({ error: 'Failed to fetch resources' });
  }
});

// POST /api/trade/portal/concierge
tradeRouter.post('/portal/concierge', portalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { subject, message, order_id, category } = req.body;
    if (!subject || !message) {
      res.status(400).json({ error: 'Subject and message required' });
      return;
    }

    const member = await tradeService.getMember(req.portalMember!.member_id);
    if (!member) {
      res.status(404).json({ error: 'Member not found' });
      return;
    }

    const settings = await tradeService.getTradeSettings(req.portalMember!.brand_id);

    // Create priority ticket in existing ticket system
    const ticket = await createTicket({
      source: 'form',
      subject,
      customer_email: member.email,
      customer_name: member.contact_name,
      shopify_customer_id: member.shopify_customer_id,
      priority: settings.ticket_priority_level as 'low' | 'medium' | 'high' | 'urgent',
      category: category || 'trade_concierge',
      tags: ['trade-member', 'trade-concierge'],
      order_id: order_id || undefined,
      metadata: { trade_member_id: member.id, company_name: member.company_name },
      brand_id: req.portalMember!.brand_id,
    });

    // Add the message as first ticket message
    await addTicketMessage(ticket.id, {
      sender_type: 'customer',
      sender_name: member.contact_name,
      sender_email: member.email,
      content: message,
    });

    await tradeService.logTradeEvent({
      brand_id: req.portalMember!.brand_id,
      member_id: member.id,
      event_type: 'concierge_request',
      actor: 'customer',
      actor_id: member.email,
      details: { ticket_id: ticket.id, subject },
    });

    res.status(201).json({ ticket_number: ticket.ticket_number, message: 'Concierge request submitted' });
  } catch (err) {
    console.error('[trade.controller] POST /portal/concierge error:', err);
    res.status(500).json({ error: 'Failed to submit concierge request' });
  }
});
