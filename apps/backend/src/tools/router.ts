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
          toolInput.context as string
        );
        return { success: true, data: result };
      }

      case 'get_product_details': {
        const productId = toolInput.product_id as string;
        const [mcpResult, metafields] = await Promise.all([
          shopifyMcp.getProductDetails(productId),
          shopifyAdmin.getProductMetafields(productId).catch((err) => {
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
          toolInput.context as string
        );
        return { success: true, data: result };
      }

      case 'lookup_order': {
        const result = await shopifyAdmin.lookupOrder(
          toolInput.order_number as string,
          toolInput.email as string | undefined,
          toolInput.phone as string | undefined
        );
        return { success: true, data: result };
      }

      case 'check_return_eligibility': {
        const result = await shopifyAdmin.checkReturnEligibility(
          toolInput.order_id as string
        );
        return { success: true, data: result };
      }

      case 'initiate_return': {
        const result = await shopifyAdmin.initiateReturn(
          toolInput.order_id as string,
          toolInput.line_item_ids as string[],
          toolInput.reason as string,
          context.conversationId
        );
        return { success: true, data: result };
      }

      case 'search_knowledge_base': {
        const docs = await knowledgeService.searchKnowledge(
          toolInput.query as string
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
        });
        return { success: true, data: result };
      }

      case 'get_cart': {
        const result = await shopifyMcp.getCart(toolInput.cart_id as string);
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
          toolInput.order_name as string
        );
        return { success: result.success, data: result };
      }

      case 'escalate_to_human': {
        await conversationService.updateConversation(context.conversationId, {
          status: 'escalated',
        });

        const escalationReason = toolInput.reason as string;
        const escalationSummary = (toolInput.summary as string) ?? escalationReason;
        const recommendedActions = (toolInput.recommended_actions as string[]) ?? [];
        let ticketNumber: number | null = null;

        // Attempt to create a support ticket if we have customer email
        if (context.customerEmail) {
          try {
            const ticket = await ticketService.createTicketFromEscalation(
              context.conversationId,
              {
                customer_email: context.customerEmail,
                reason: escalationReason,
                priority: (toolInput.priority as 'low' | 'medium' | 'high' | 'urgent') ?? 'medium',
                summary: escalationSummary,
                recommendedActions,
              }
            );
            ticketNumber = ticket.ticket_number;
            console.log(`[tool-router] Created escalation ticket #${ticketNumber} for conversation ${context.conversationId}`);
          } catch (err) {
            console.error('[tool-router] Failed to create escalation ticket:', err instanceof Error ? err.message : err);
          }
        } else {
          console.log(`[tool-router] No customerEmail in context — escalation ticket not created for conversation ${context.conversationId}`);
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
              ? `Conversation marked as escalated. Support ticket #${ticketNumber} has been created. Direct the customer to email support@outlight.us or visit https://outlight.us/pages/contact. Email response time is 1-2 business days. Do NOT say the conversation has been flagged as high priority or that the team will follow up from this chat.`
              : 'Conversation marked as escalated. A support ticket could not be created because no customer email is on file — ask the customer for their email so the team can follow up. Direct the customer to email support@outlight.us or visit https://outlight.us/pages/contact. Email response time is 1-2 business days.',
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
