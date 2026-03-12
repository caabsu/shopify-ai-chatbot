import { supabase } from '../config/supabase.js';
import type { ReturnRule, ReturnRequest } from '../types/index.js';

interface RuleEvaluation {
  action: 'auto_approve' | 'auto_deny' | 'flag_review' | 'ai_review';
  rule?: ReturnRule;
  resolution_type?: 'refund' | 'exchange' | 'store_credit' | null;
}

interface OrderData {
  created_at: string;
  total_price?: number;
  [key: string]: unknown;
}

// ── Evaluate Rules Against a Return Request ──────────────────────────────
export async function evaluateRules(
  brandId: string,
  returnRequest: ReturnRequest,
  orderData: OrderData
): Promise<RuleEvaluation> {
  const rules = await getRules(brandId);
  const enabledRules = rules.filter((r) => r.enabled);

  if (enabledRules.length === 0) {
    // No rules configured — default to flagging for review
    return { action: 'flag_review' };
  }

  // Calculate derived values for condition matching
  const totalReturnAmount = (returnRequest.items ?? []).reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const orderAgeDays = Math.floor(
    (Date.now() - new Date(orderData.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );

  const itemReasons = (returnRequest.items ?? []).map((item) => item.reason);

  // Evaluate rules in priority order (lower priority number = higher priority)
  for (const rule of enabledRules) {
    if (matchesConditions(rule.conditions, { totalReturnAmount, orderAgeDays, itemReasons })) {
      console.log(`[return-rules.service] Rule matched: "${rule.name}" (${rule.action}) for return ${returnRequest.id}`);
      return {
        action: rule.action,
        rule,
        resolution_type: rule.resolution_type,
      };
    }
  }

  // No rules matched — default to flagging for review
  return { action: 'flag_review' };
}

// ── Condition Matching Logic ──────────────────────────────────────────────
function matchesConditions(
  conditions: Record<string, unknown>,
  context: {
    totalReturnAmount: number;
    orderAgeDays: number;
    itemReasons: string[];
  }
): boolean {
  // Empty conditions = catch-all, matches everything
  if (Object.keys(conditions).length === 0) {
    return true;
  }

  // Check each condition — all must match (AND logic)
  if (conditions.reason !== undefined) {
    const requiredReason = conditions.reason as string;
    const hasMatchingReason = context.itemReasons.some((r) => r === requiredReason);
    if (!hasMatchingReason) return false;
  }

  if (conditions.amount_under !== undefined) {
    const threshold = conditions.amount_under as number;
    if (context.totalReturnAmount >= threshold) return false;
  }

  if (conditions.order_age_days_under !== undefined) {
    const maxDays = conditions.order_age_days_under as number;
    if (context.orderAgeDays >= maxDays) return false;
  }

  return true;
}

// ── Get All Rules ─────────────────────────────────────────────────────────
export async function getRules(brandId: string): Promise<ReturnRule[]> {
  const { data: rows, error } = await supabase
    .from('return_rules')
    .select()
    .eq('brand_id', brandId)
    .order('priority', { ascending: true });

  if (error) {
    console.error('[return-rules.service] getRules error:', error.message);
    throw new Error('Failed to get return rules');
  }

  return (rows ?? []) as ReturnRule[];
}

// ── Create Rule ───────────────────────────────────────────────────────────
export async function createRule(
  brandId: string,
  data: {
    name: string;
    enabled?: boolean;
    priority?: number;
    conditions: Record<string, unknown>;
    action: ReturnRule['action'];
    resolution_type?: ReturnRule['resolution_type'];
  }
): Promise<ReturnRule> {
  const { data: row, error } = await supabase
    .from('return_rules')
    .insert({
      brand_id: brandId,
      name: data.name,
      enabled: data.enabled ?? true,
      priority: data.priority ?? 100,
      conditions: data.conditions,
      action: data.action,
      resolution_type: data.resolution_type ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('[return-rules.service] createRule error:', error.message);
    throw new Error('Failed to create return rule');
  }

  console.log(`[return-rules.service] Created rule "${data.name}" for brand ${brandId}`);
  return row as ReturnRule;
}

// ── Update Rule ───────────────────────────────────────────────────────────
export async function updateRule(
  id: string,
  data: Partial<Pick<ReturnRule, 'name' | 'enabled' | 'priority' | 'conditions' | 'action' | 'resolution_type'>>
): Promise<ReturnRule> {
  const updatePayload: Record<string, unknown> = {
    ...data,
    updated_at: new Date().toISOString(),
  };

  const { data: row, error } = await supabase
    .from('return_rules')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[return-rules.service] updateRule error:', error.message);
    throw new Error('Failed to update return rule');
  }

  console.log(`[return-rules.service] Updated rule ${id}`);
  return row as ReturnRule;
}

// ── Delete Rule ───────────────────────────────────────────────────────────
export async function deleteRule(id: string): Promise<void> {
  const { error } = await supabase
    .from('return_rules')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[return-rules.service] deleteRule error:', error.message);
    throw new Error('Failed to delete return rule');
  }

  console.log(`[return-rules.service] Deleted rule ${id}`);
}
