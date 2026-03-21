import * as tradeService from './trade.service.js';
import * as shopifyB2B from './trade-shopify.service.js';
import { sendTradeWelcomeEmail, sendTradeRejectionEmail, sendTradeApplicationReceivedEmail } from './trade-email.service.js';
import { TradeApplication, TradeSettings } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

export function evaluateAutoApproveRules(
  application: TradeApplication,
  settings: TradeSettings
): boolean {
  if (!settings.auto_approve_enabled) return false;

  const { rules, logic } = settings.auto_approve_rules;
  const enabledRules = rules.filter((r) => r.enabled);
  if (enabledRules.length === 0) return false;

  const results = enabledRules.map((rule) => {
    const value = (application as unknown as Record<string, unknown>)[rule.field];
    switch (rule.condition) {
      case 'is_not_empty':
        return value !== null && value !== undefined && String(value).trim() !== '';
      case 'contains':
        return typeof value === 'string' && rule.value ? value.toLowerCase().includes(rule.value.toLowerCase()) : false;
      case 'equals':
        return String(value) === rule.value;
      case 'one_of':
        return rule.value ? rule.value.split(',').map((v) => v.trim()).includes(String(value)) : false;
      default:
        return false;
    }
  });

  return logic === 'all' ? results.every(Boolean) : results.some(Boolean);
}

export async function processApproval(
  application: TradeApplication,
  options: {
    brandId: string;
    payment_terms?: string;
    notes?: string;
    actorId?: string;
    actorType?: 'system' | 'agent';
  }
): Promise<void> {
  const settings = await tradeService.getTradeSettings(options.brandId);
  const catalogId = (settings.metadata as Record<string, string>)?.shopify_catalog_id;
  if (!catalogId) {
    throw new Error('Trade catalog ID not configured in trade_settings.metadata.shopify_catalog_id');
  }

  // Steps 1-3: Create customer + company + contact with ordering role
  // Use the combined companyCreate approach for new customers — this auto-assigns the
  // "Ordering only" role without needing read_companies/write_companies scopes.
  let shopifyCustomerId = application.shopify_customer_id;
  let isNewCustomer = false;
  let companyId: string;
  let locationId: string;

  const nameParts = application.full_name.split(' ');
  const firstName = nameParts[0] || application.full_name;
  const lastName = nameParts.slice(1).join(' ') || '';
  const externalId = `TRADE-${application.id.slice(0, 8)}`;

  // Check if customer already exists in Shopify
  if (!shopifyCustomerId) {
    const existing = await shopifyB2B.findCustomerByEmail(application.email, options.brandId).catch(() => null);
    if (existing) {
      shopifyCustomerId = existing.id;
    }
  }

  if (!shopifyCustomerId) {
    // NEW customer — use combined companyCreate with companyContact.
    // This creates customer + company + contact + auto-assigns ordering role in one call.
    try {
      const result = await shopifyB2B.createCompanyWithContact(
        {
          name: application.company_name,
          externalId,
          note: `${application.business_type} | ${application.website_url}`,
          contactEmail: application.email,
          contactFirstName: firstName,
          contactLastName: lastName,
        },
        options.brandId
      );
      companyId = result.companyId;
      locationId = result.locationId;
      shopifyCustomerId = result.customerId;
      isNewCustomer = true;
      console.log(`[trade-approval] Combined create done: companyId=${companyId}, locationId=${locationId}, customerId=${shopifyCustomerId}`);
    } catch (err) {
      throw new Error(`[Steps 1-3 - Combined Create] ${err instanceof Error ? err.message : err}`);
    }
  } else {
    // EXISTING customer — create company, then assign contact with proper role.
    // Uses company.contactRoles (per-company) to discover role IDs.
    try {
      const result = await shopifyB2B.createCompany(
        {
          name: application.company_name,
          externalId,
          note: `${application.business_type} | ${application.website_url}`,
        },
        options.brandId
      );
      companyId = result.companyId;
      locationId = result.locationId;
    } catch (err) {
      throw new Error(`[Step 2 - Company] ${err instanceof Error ? err.message : err}`);
    }

    try {
      await shopifyB2B.createCompanyContact(companyId, shopifyCustomerId, options.brandId, locationId);
    } catch (err) {
      throw new Error(`[Step 3 - Contact] ${err instanceof Error ? err.message : err}`);
    }
    console.log(`[trade-approval] Existing customer flow done: companyId=${companyId}, locationId=${locationId}`);
  }

  // Step 4: Assign catalog to company location
  try {
    await shopifyB2B.assignCatalogToLocation(catalogId, locationId, options.brandId);
  } catch (err) {
    throw new Error(`[Step 4 - Catalog] catalogId=${catalogId}, locationId=${locationId}: ${err instanceof Error ? err.message : err}`);
  }

  console.log(`[trade-approval] Step 4 done: catalog assigned`);

  // Step 5: Create trade_members record first (to get the real UUID)
  const paymentTerms = options.payment_terms || settings.default_payment_terms;
  const member = await tradeService.createMember({
    brand_id: options.brandId,
    application_id: application.id,
    shopify_customer_id: shopifyCustomerId,
    shopify_company_id: companyId,
    company_name: application.company_name,
    contact_name: application.full_name,
    email: application.email,
    phone: application.phone,
    business_type: application.business_type,
    website_url: application.website_url,
    payment_terms: paymentTerms,
  });

  // Store locationId in member metadata for suspension/reactivation
  await tradeService.updateMember(member.id, {
    metadata: { shopify_location_id: locationId },
  } as any);

  // Step 6: Update customer tags + metafields (using real member ID)
  try {
    await shopifyB2B.updateCustomerTags(
      shopifyCustomerId,
      ['trade-program', `trade-${application.business_type}`],
      [
        { namespace: 'trade_program', key: 'company_name', value: application.company_name, type: 'single_line_text_field' },
        { namespace: 'trade_program', key: 'business_type', value: application.business_type, type: 'single_line_text_field' },
        { namespace: 'trade_program', key: 'status', value: 'active', type: 'single_line_text_field' },
        { namespace: 'trade_program', key: 'approved_date', value: new Date().toISOString().split('T')[0], type: 'date' },
        { namespace: 'trade_program', key: 'member_id', value: member.id, type: 'single_line_text_field' },
      ],
      options.brandId
    );
  } catch (err) {
    throw new Error(`[Step 6 - Tags] customerId=${shopifyCustomerId}: ${err instanceof Error ? err.message : err}`);
  }

  // Step 6b: Send account invite for new customers
  if (isNewCustomer) {
    await shopifyB2B.sendAccountInvite(shopifyCustomerId, options.brandId)
      .catch((err) => console.error('[trade-approval] Account invite email failed:', err));
  }

  // Step 7: Update application
  await tradeService.updateApplication(application.id, {
    status: 'approved',
    shopify_customer_id: shopifyCustomerId,
    shopify_company_id: companyId,
    auto_approved: options.actorType === 'system',
    reviewed_by: options.actorId || null,
    reviewed_at: new Date().toISOString(),
  } as any);

  // Step 8: Send welcome email (fire-and-forget)
  sendTradeWelcomeEmail({
    to: application.email,
    full_name: application.full_name,
    company_name: application.company_name,
    discount_code: settings.discount_code,
    payment_terms: paymentTerms,
    concierge_email: settings.concierge_email,
    is_new_customer: isNewCustomer,
    brandId: options.brandId,
  }).catch((err) => console.error('[trade-approval] Welcome email failed:', err));

  // Step 9: Log event
  await tradeService.logTradeEvent({
    brand_id: options.brandId,
    application_id: application.id,
    event_type: options.actorType === 'system' ? 'auto_approved' : 'manually_approved',
    actor: options.actorType || 'agent',
    actor_id: options.actorId,
    details: { payment_terms: paymentTerms, shopify_company_id: companyId },
  });
}

export async function processRejection(
  application: TradeApplication,
  options: {
    brandId: string;
    reason: string;
    actorId: string;
  }
): Promise<void> {
  await tradeService.updateApplication(application.id, {
    status: 'rejected',
    rejection_reason: options.reason,
    reviewed_by: options.actorId,
    reviewed_at: new Date().toISOString(),
  } as any);

  sendTradeRejectionEmail({
    to: application.email,
    full_name: application.full_name,
    company_name: application.company_name,
    reason: options.reason,
    brandId: options.brandId,
  }).catch((err) => console.error('[trade-approval] Rejection email failed:', err));

  await tradeService.logTradeEvent({
    brand_id: options.brandId,
    application_id: application.id,
    event_type: 'rejected',
    actor: 'agent',
    actor_id: options.actorId,
    details: { reason: options.reason },
  });
}

export async function processSuspension(
  memberId: string,
  options: { brandId: string; actorId: string }
): Promise<void> {
  const member = await tradeService.getMember(memberId);
  if (!member) throw new Error('Member not found');

  const settings = await tradeService.getTradeSettings(options.brandId);
  const catalogId = (settings.metadata as Record<string, string>)?.shopify_catalog_id;

  // Remove catalog from company location
  if (catalogId && (member.metadata as Record<string, string>)?.shopify_location_id) {
    await shopifyB2B.removeCatalogFromLocation(
      catalogId,
      (member.metadata as Record<string, string>).shopify_location_id,
      options.brandId
    ).catch((err) => console.error('[trade-approval] removeCatalog error:', err));
  }

  // Remove tags
  await shopifyB2B.removeCustomerTags(
    member.shopify_customer_id,
    ['trade-program', `trade-${member.business_type}`],
    options.brandId
  ).catch((err) => console.error('[trade-approval] removeTag error:', err));

  // Update metafield
  await shopifyB2B.updateCustomerTags(
    member.shopify_customer_id,
    [],
    [{ namespace: 'trade_program', key: 'status', value: 'suspended', type: 'single_line_text_field' }],
    options.brandId
  ).catch((err) => console.error('[trade-approval] updateMetafield error:', err));

  await tradeService.updateMember(memberId, { status: 'suspended' } as any, options.actorId);

  await tradeService.logTradeEvent({
    brand_id: options.brandId,
    member_id: memberId,
    event_type: 'member_suspended',
    actor: 'agent',
    actor_id: options.actorId,
  });
}

export async function processReactivation(
  memberId: string,
  options: { brandId: string; actorId: string }
): Promise<void> {
  const member = await tradeService.getMember(memberId);
  if (!member) throw new Error('Member not found');

  const settings = await tradeService.getTradeSettings(options.brandId);
  const catalogId = (settings.metadata as Record<string, string>)?.shopify_catalog_id;

  // Re-assign catalog
  if (catalogId && (member.metadata as Record<string, string>)?.shopify_location_id) {
    await shopifyB2B.assignCatalogToLocation(
      catalogId,
      (member.metadata as Record<string, string>).shopify_location_id,
      options.brandId
    );
  }

  // Re-add tags + update metafield
  await shopifyB2B.updateCustomerTags(
    member.shopify_customer_id,
    ['trade-program', `trade-${member.business_type}`],
    [{ namespace: 'trade_program', key: 'status', value: 'active', type: 'single_line_text_field' }],
    options.brandId
  );

  await tradeService.updateMember(memberId, { status: 'active' } as any, options.actorId);

  await tradeService.logTradeEvent({
    brand_id: options.brandId,
    member_id: memberId,
    event_type: 'member_reactivated',
    actor: 'agent',
    actor_id: options.actorId,
  });
}
