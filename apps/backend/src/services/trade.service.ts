import { supabase } from '../config/supabase.js';
import { TradeApplication, TradeMember, TradeSettings, TradeActivityLog } from '../types/index.js';

// ========== ACTIVITY LOG ==========

async function logTradeEvent(data: {
  brand_id: string;
  member_id?: string;
  application_id?: string;
  event_type: string;
  actor: 'system' | 'agent' | 'customer';
  actor_id?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.from('trade_activity_log').insert({
    brand_id: data.brand_id,
    member_id: data.member_id || null,
    application_id: data.application_id || null,
    event_type: data.event_type,
    actor: data.actor,
    actor_id: data.actor_id || null,
    details: data.details || {},
  });
  if (error) console.error('[trade.service] logTradeEvent error:', error.message);
}

// ========== SETTINGS ==========

export async function getTradeSettings(brandId: string): Promise<TradeSettings> {
  const { data, error } = await supabase
    .from('trade_settings')
    .select('*')
    .eq('brand_id', brandId)
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No settings yet — create default
      const { data: created, error: createErr } = await supabase
        .from('trade_settings')
        .insert({ brand_id: brandId })
        .select()
        .single();
      if (createErr) throw new Error('Failed to create trade settings');
      return created as TradeSettings;
    }
    throw new Error('Failed to fetch trade settings');
  }
  return data as TradeSettings;
}

export async function updateTradeSettings(
  brandId: string,
  updates: Partial<TradeSettings>,
  actorId?: string
): Promise<TradeSettings> {
  const { data, error } = await supabase
    .from('trade_settings')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('brand_id', brandId)
    .select()
    .single();

  if (error) throw new Error('Failed to update trade settings');

  await logTradeEvent({
    brand_id: brandId,
    event_type: 'settings_updated',
    actor: 'agent',
    actor_id: actorId,
    details: { updates },
  });

  return data as TradeSettings;
}

// ========== APPLICATIONS ==========

export async function createApplication(data: {
  brand_id: string;
  full_name: string;
  email: string;
  phone?: string;
  company_name: string;
  business_type: string;
  website_url: string;
  project_description?: string;
  referral_source?: string;
  shopify_customer_id?: string;
  metadata?: Record<string, unknown>;
}): Promise<TradeApplication> {
  const { data: app, error } = await supabase
    .from('trade_applications')
    .insert({
      brand_id: data.brand_id,
      full_name: data.full_name,
      email: data.email.toLowerCase().trim(),
      phone: data.phone,
      company_name: data.company_name,
      business_type: data.business_type,
      website_url: data.website_url,
      project_description: data.project_description || null,
      referral_source: data.referral_source || null,
      shopify_customer_id: data.shopify_customer_id || null,
      metadata: data.metadata || {},
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('An application with this email is already pending or approved');
    }
    throw new Error('Failed to create application: ' + error.message);
  }

  await logTradeEvent({
    brand_id: data.brand_id,
    application_id: app.id,
    event_type: 'application_submitted',
    actor: 'customer',
    actor_id: data.email,
    details: { company_name: data.company_name, business_type: data.business_type },
  });

  return app as TradeApplication;
}

export async function getApplication(id: string): Promise<TradeApplication | null> {
  const { data, error } = await supabase
    .from('trade_applications')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error('Failed to fetch application');
  }
  return data as TradeApplication;
}

export async function listApplications(filters: {
  brand_id: string;
  status?: string;
  business_type?: string;
  search?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}): Promise<{ applications: TradeApplication[]; total: number; page: number; totalPages: number }> {
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('trade_applications')
    .select('*', { count: 'exact' })
    .eq('brand_id', filters.brand_id);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.business_type) query = query.eq('business_type', filters.business_type);
  if (filters.search) {
    query = query.or(
      `full_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,company_name.ilike.%${filters.search}%`
    );
  }

  const sortField = filters.sort || 'created_at';
  const sortOrder = filters.order === 'asc' ? true : false;
  query = query.order(sortField, { ascending: sortOrder }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw new Error('Failed to list applications');

  const total = count || 0;
  return {
    applications: (data || []) as TradeApplication[],
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function updateApplication(
  id: string,
  updates: Partial<TradeApplication>
): Promise<TradeApplication> {
  const { data, error } = await supabase
    .from('trade_applications')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error('Failed to update application');
  return data as TradeApplication;
}

export async function archiveApplication(id: string, brandId: string, actorId?: string): Promise<void> {
  const { error } = await supabase
    .from('trade_applications')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('brand_id', brandId);

  if (error) throw new Error('Failed to archive application');

  await logTradeEvent({
    brand_id: brandId,
    application_id: id,
    event_type: 'application_archived',
    actor: 'agent',
    actor_id: actorId,
  });
}

export async function deleteApplication(id: string, brandId: string, actorId?: string): Promise<void> {
  // Delete activity log entries first
  await supabase
    .from('trade_activity_log')
    .delete()
    .eq('application_id', id)
    .eq('brand_id', brandId);

  const { error } = await supabase
    .from('trade_applications')
    .delete()
    .eq('id', id)
    .eq('brand_id', brandId);

  if (error) throw new Error('Failed to delete application');
}

export async function bulkArchiveApplications(ids: string[], brandId: string, actorId?: string): Promise<number> {
  const { data, error } = await supabase
    .from('trade_applications')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .in('id', ids)
    .eq('brand_id', brandId)
    .select('id');

  if (error) throw new Error('Failed to archive applications');

  const count = data?.length ?? 0;
  for (const row of data ?? []) {
    await logTradeEvent({
      brand_id: brandId,
      application_id: row.id,
      event_type: 'application_archived',
      actor: 'agent',
      actor_id: actorId,
    });
  }
  return count;
}

export async function bulkDeleteApplications(ids: string[], brandId: string): Promise<number> {
  // Delete activity log entries first
  await supabase
    .from('trade_activity_log')
    .delete()
    .in('application_id', ids)
    .eq('brand_id', brandId);

  const { data, error } = await supabase
    .from('trade_applications')
    .delete()
    .in('id', ids)
    .eq('brand_id', brandId)
    .select('id');

  if (error) throw new Error('Failed to delete applications');
  return data?.length ?? 0;
}

// ========== MEMBERS ==========

export async function createMember(data: {
  brand_id: string;
  application_id: string;
  shopify_customer_id: string;
  shopify_company_id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone?: string;
  business_type: string;
  website_url: string;
  payment_terms?: string;
}): Promise<TradeMember> {
  const { data: member, error } = await supabase
    .from('trade_members')
    .insert({
      brand_id: data.brand_id,
      application_id: data.application_id,
      shopify_customer_id: data.shopify_customer_id,
      shopify_company_id: data.shopify_company_id,
      company_name: data.company_name,
      contact_name: data.contact_name,
      email: data.email.toLowerCase().trim(),
      phone: data.phone,
      business_type: data.business_type,
      website_url: data.website_url,
      payment_terms: data.payment_terms || 'DUE_ON_FULFILLMENT',
    })
    .select()
    .single();

  if (error) throw new Error('Failed to create member: ' + error.message);

  await logTradeEvent({
    brand_id: data.brand_id,
    member_id: member.id,
    application_id: data.application_id,
    event_type: 'member_created',
    actor: 'system',
    details: { company_name: data.company_name },
  });

  return member as TradeMember;
}

export async function getMember(id: string): Promise<TradeMember | null> {
  const { data, error } = await supabase
    .from('trade_members')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error('Failed to fetch member');
  }
  return data as TradeMember;
}

export async function getMemberByEmail(email: string, brandId: string): Promise<TradeMember | null> {
  const { data, error } = await supabase
    .from('trade_members')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .eq('brand_id', brandId)
    .eq('status', 'active')
    .maybeSingle();

  if (error) throw new Error('Failed to fetch member by email');
  return data as TradeMember | null;
}

export async function listMembers(filters: {
  brand_id: string;
  status?: string;
  business_type?: string;
  search?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}): Promise<{ members: TradeMember[]; total: number; page: number; totalPages: number }> {
  const page = filters.page || 1;
  const limit = filters.limit || 20;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('trade_members')
    .select('*', { count: 'exact' })
    .eq('brand_id', filters.brand_id);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.business_type) query = query.eq('business_type', filters.business_type);
  if (filters.search) {
    query = query.or(
      `contact_name.ilike.%${filters.search}%,email.ilike.%${filters.search}%,company_name.ilike.%${filters.search}%`
    );
  }

  const sortField = filters.sort || 'created_at';
  const sortOrder = filters.order === 'asc' ? true : false;
  query = query.order(sortField, { ascending: sortOrder }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw new Error('Failed to list members');

  const total = count || 0;
  return {
    members: (data || []) as TradeMember[],
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

export async function updateMember(
  id: string,
  updates: Partial<TradeMember>,
  actorId?: string
): Promise<TradeMember> {
  const { data, error } = await supabase
    .from('trade_members')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error('Failed to update member');
  return data as TradeMember;
}

// ========== ACTIVITY LOG ==========

export async function getActivityLog(filters: {
  brand_id: string;
  member_id?: string;
  application_id?: string;
  limit?: number;
}): Promise<TradeActivityLog[]> {
  let query = supabase
    .from('trade_activity_log')
    .select('*')
    .eq('brand_id', filters.brand_id)
    .order('created_at', { ascending: false })
    .limit(filters.limit || 50);

  if (filters.member_id) query = query.eq('member_id', filters.member_id);
  if (filters.application_id) query = query.eq('application_id', filters.application_id);

  const { data, error } = await query;
  if (error) throw new Error('Failed to fetch activity log');
  return (data || []) as TradeActivityLog[];
}

// ========== ANALYTICS ==========

export async function getTradeAnalytics(brandId: string, period: string = '30d'): Promise<{
  total_members: number;
  pending_applications: number;
  total_trade_revenue: number;
  avg_order_value: number;
  top_members: TradeMember[];
}> {
  const [membersResult, applicationsResult, topMembersResult] = await Promise.all([
    supabase.from('trade_members').select('*', { count: 'exact' }).eq('brand_id', brandId).eq('status', 'active'),
    supabase.from('trade_applications').select('*', { count: 'exact' }).eq('brand_id', brandId).eq('status', 'pending'),
    supabase.from('trade_members').select('*').eq('brand_id', brandId).eq('status', 'active').order('total_spent', { ascending: false }).limit(5),
  ]);

  const members = (topMembersResult.data || []) as TradeMember[];
  const totalRevenue = members.reduce((sum, m) => sum + Number(m.total_spent), 0);
  const totalOrders = members.reduce((sum, m) => sum + m.total_orders, 0);

  return {
    total_members: membersResult.count || 0,
    pending_applications: applicationsResult.count || 0,
    total_trade_revenue: totalRevenue,
    avg_order_value: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    top_members: members,
  };
}

export { logTradeEvent };
