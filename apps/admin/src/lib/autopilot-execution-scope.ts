import { createHash } from 'node:crypto';
import type { AutopilotAction, AutopilotPlan } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_AUTOPILOT_EXECUTION_SCOPES = 50;

type ExecutionScopeTicket = {
  id: string;
  customer_email?: unknown;
  customer_email_normalized?: unknown;
  shopify_customer_id?: unknown;
  order_id?: unknown;
};

export class ExecutionScopeDerivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutionScopeDerivationError';
  }
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  return normalized || null;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalShopifyId(value: unknown, resource: 'Order' | 'Customer'): string | null {
  const raw = nonEmptyString(value);
  if (!raw) return null;
  const numeric = raw.match(/^\d+$/)?.[0];
  if (numeric) return numeric;
  const gid = raw.match(new RegExp(`^gid://shopify/${resource}/(\\d+)$`, 'i'))?.[1];
  return gid ?? raw.toLowerCase();
}

export function customerEmailExecutionScopeKey(value: unknown): string | null {
  const email = nonEmptyString(value)?.toLowerCase();
  return email ? `customer-email:sha256:${digest(email)}` : null;
}

export function shopifyCustomerExecutionScopeKey(value: unknown): string | null {
  const customerId = canonicalShopifyId(value, 'Customer');
  return customerId ? `shopify-customer:sha256:${digest(customerId)}` : null;
}

export function orderExecutionScopeKey(value: unknown): string | null {
  const orderId = canonicalShopifyId(value, 'Order');
  return orderId ? `order:sha256:${digest(orderId)}` : null;
}

export function ticketExecutionScopeKey(value: unknown): string {
  const ticketId = nonEmptyString(value)?.toLowerCase();
  if (!ticketId || !UUID_PATTERN.test(ticketId)) {
    throw new ExecutionScopeDerivationError('The execution scope contains an invalid ticket ID.');
  }
  return `ticket:${ticketId}`;
}

function actionsParticipatingInExecution(plan: Pick<AutopilotPlan, 'actions'>): AutopilotAction[] {
  return plan.actions.filter((action) => action.status !== 'skipped');
}

/**
 * Every action in one approved plan uses this same conservative scope set.
 * That prevents a reply from overlapping an order mutation or related-ticket
 * consolidation from another plan, while hashes keep customer identifiers out
 * of the lock index.
 */
export function deriveAutopilotExecutionScopeKeys(input: {
  ticket: ExecutionScopeTicket;
  plan: Pick<AutopilotPlan, 'actions'>;
}): string[] {
  const scopes = new Set<string>([ticketExecutionScopeKey(input.ticket.id)]);
  const normalizedEmail = nonEmptyString(input.ticket.customer_email_normalized)
    ?? nonEmptyString(input.ticket.customer_email);
  const emailScope = customerEmailExecutionScopeKey(normalizedEmail);
  if (emailScope) scopes.add(emailScope);
  const customerScope = shopifyCustomerExecutionScopeKey(input.ticket.shopify_customer_id);
  if (customerScope) scopes.add(customerScope);
  const ticketOrderScope = orderExecutionScopeKey(input.ticket.order_id);
  if (ticketOrderScope) scopes.add(ticketOrderScope);

  for (const action of actionsParticipatingInExecution(input.plan)) {
    if (action.type === 'cancel_order'
        || action.type === 'refund_order'
        || action.type === 'update_shipping_address') {
      const orderScope = orderExecutionScopeKey(action.params.order_id);
      if (!orderScope) {
        throw new ExecutionScopeDerivationError(
          `Action "${action.title}" has no valid Shopify order scope.`,
        );
      }
      scopes.add(orderScope);
    }
    if (action.type !== 'consolidate_related_tickets') continue;
    if (!Array.isArray(action.params.related_tickets) || action.params.related_tickets.length === 0) {
      throw new ExecutionScopeDerivationError(
        `Action "${action.title}" has no valid related-ticket execution scope.`,
      );
    }
    for (const related of action.params.related_tickets) {
      if (!related || typeof related !== 'object') {
        throw new ExecutionScopeDerivationError(
          `Action "${action.title}" contains an invalid related-ticket execution scope.`,
        );
      }
      scopes.add(ticketExecutionScopeKey((related as Record<string, unknown>).ticket_id));
    }
  }

  const result = [...scopes].sort();
  if (result.length > MAX_AUTOPILOT_EXECUTION_SCOPES) {
    throw new ExecutionScopeDerivationError(
      `This plan spans ${result.length} execution scopes; the safe maximum is ${MAX_AUTOPILOT_EXECUTION_SCOPES}.`,
    );
  }
  return result;
}
