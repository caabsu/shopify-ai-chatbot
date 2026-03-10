import * as shopifyMcp from '../services/shopify-mcp.service.js';
import * as shopifyAdmin from '../services/shopify-admin.service.js';
import * as shopifyActions from '../services/shopify-actions.service.js';
import * as knowledgeService from '../services/knowledge.service.js';
import * as conversationService from '../services/conversation.service.js';
import * as ticketService from '../services/ticket.service.js';

export interface ToolContext {
  conversationId: string;
  customerEmail?: string;
  pageUrl?: string;
  cartId?: string;
  brandId?: string;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case 'search_products': {
        const result = await shopifyMcp.searchProducts(
          toolInput.query as string,
          toolInput.context as string,
          undefined,
          context.brandId
        );
        return { success: true, data: result };
      }

      case 'get_product_details': {
        const productId = toolInput.product_id as string;
        const [mcpResult, metafields] = await Promise.all([
          shopifyMcp.getProductDetails(productId, undefined, context.brandId),
          shopifyAdmin.getProductMetafields(productId, context.brandId).catch((err) => {
            console.warn('[tool-router] Failed to fetch metafields for', productId, ':', err instanceof Error ? err.message : err);
            return null;
          }),
        ]);
        const metafieldCount = metafields ? Object.keys(metafields).length : 0;
        console.log(`[tool-router] get_product_details: product=${productId}, metafields=${metafieldCount}`);
        return { success: true, data: { ...(mcpResult as Record<string, unknown>), metafields } };
      }

      case 'answer_store_policy': {
        const result = await shopifyMcp.searchPolicies(
          toolInput.query as string,
          toolInput.context as string,
          context.brandId
        );
        return { success: true, data: result };
      }

      case 'lookup_order': {
        const result = await shopifyAdmin.lookupOrder(
          toolInput.order_number as string,
          toolInput.email as string | undefined,
          toolInput.phone as string | undefined,
          context.brandId
        );
        return { success: true, data: result };
      }

      case 'check_return_eligibility': {
        const result = await shopifyAdmin.checkReturnEligibility(
          toolInput.order_id as string,
          context.brandId
        );
        return { success: true, data: result };
      }

      case 'initiate_return': {
        const result = await shopifyAdmin.initiateReturn(
          toolInput.order_id as string,
          toolInput.line_item_ids as string[],
          toolInput.reason as string,
          context.conversationId,
          context.brandId
        );
        return { success: true, data: result };
      }

      case 'search_knowledge_base': {
        const docs = await knowledgeService.searchKnowledge(
          toolInput.query as string,
          context.brandId
        );
        return {
          success: true,
          data: docs.map((d) => ({ title: d.title, content: d.content, category: d.category })),
        };
      }

      case 'manage_cart': {
        const result = await shopifyMcp.createOrUpdateCart({
          cart_id: toolInput.cart_id as string | undefined,
          add_items: toolInput.add_items as Array<{ product_variant_id: string; quantity: number }> | undefined,
          update_items: toolInput.update_items as Array<{ id: string; quantity: number }> | undefined,
          remove_line_ids: toolInput.remove_line_ids as string[] | undefined,
          discount_codes: toolInput.discount_codes as string[] | undefined,
        }, context.brandId);
        return { success: true, data: result };
      }

      case 'get_cart': {
        const result = await shopifyMcp.getCart(toolInput.cart_id as string, context.brandId);
        return { success: true, data: result };
      }

      case 'navigate_customer': {
        return {
          success: true,
          data: {
            type: 'navigation',
            url: toolInput.url as string,
            label: toolInput.label as string,
          },
        };
      }

      case 'cancel_order': {
        const result = await shopifyActions.cancelOrder(
          toolInput.order_id as string,
          toolInput.order_name as string,
          context.brandId
        );
        return { success: result.success, data: result };
      }

      case 'escalate_to_human': {
        await conversationService.updateConversation(context.conversationId, {
          status: 'escalated',
        });

        const escalationReason = toolInput.reason as string;
        const customerEmail = (toolInput.customer_email as string) || context.customerEmail;
        const customerName = toolInput.customer_name as string | undefined;
        const escalationSummary = (toolInput.summary as string) ?? escalationReason;
        const recommendedActions = (toolInput.recommended_actions as string[]) ?? [];
        let ticketNumber: number | null = null;

        if (customerEmail) {
          // Update conversation with the email
          await conversationService.updateConversation(context.conversationId, {
            customer_email: customerEmail,
            ...(customerName ? { customer_name: customerName } : {}),
          });

          try {
            const ticket = await ticketService.createTicketFromEscalation(
              context.conversationId,
              {
                customer_email: customerEmail,
                customer_name: customerName,
                reason: escalationReason,
                priority: (toolInput.priority as 'low' | 'medium' | 'high' | 'urgent') ?? 'medium',
                summary: escalationSummary,
                recommendedActions,
                brandId: context.brandId,
              }
            );
            ticketNumber = ticket.ticket_number;
            console.log(`[tool-router] Created escalation ticket #${ticketNumber} for conversation ${context.conversationId}`);
          } catch (err) {
            console.error('[tool-router] Failed to create escalation ticket:', err instanceof Error ? err.message : err);
          }
        }

        return {
          success: true,
          data: {
            type: 'escalation',
            reason: escalationReason,
            summary: escalationSummary,
            recommended_actions: recommendedActions,
            ticket_number: ticketNumber,
            message: ticketNumber
              ? `Support ticket #${ticketNumber} created successfully. The customer will receive a confirmation email at ${customerEmail}. Tell the customer: "I've created a support ticket for you — you'll receive a confirmation email shortly. Our team will follow up with you via email."`
              : 'Could not create ticket — no customer email provided. Ask the customer for their email address so you can create the ticket.',
          },
        };
      }

      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[tool-router] Error executing ${toolName}:`, message);
    return { success: false, error: `Tool "${toolName}" failed: ${message}` };
  }
}
