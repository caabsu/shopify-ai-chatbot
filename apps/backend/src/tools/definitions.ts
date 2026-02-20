import type Anthropic from '@anthropic-ai/sdk';

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: 'search_products',
    description:
      'Search the store product catalog using natural language. Use when customer asks about products, availability, pricing, or wants recommendations. Returns product titles, prices, images, and availability.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query (e.g., "red sneakers", "summer dresses under $50")',
        },
        context: {
          type: 'string',
          description: 'Conversation context to help improve search relevance (e.g., "Customer is looking for running shoes")',
        },
      },
      required: ['query', 'context'],
    },
  },
  {
    name: 'get_product_details',
    description:
      'Get detailed information about a specific product including all variants, images, pricing, availability, and metafields (delivery time, measurements, finish, light source, installation guide, reviews). Use after a product search when the customer wants more details, asks about delivery time, specifications, or reviews.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: {
          type: 'string',
          description: 'The Shopify product ID (GID format, e.g., "gid://shopify/Product/123456789")',
        },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'answer_store_policy',
    description:
      'Answer questions about store policies including shipping, returns, refunds, hours, contact info, and FAQs. Use for any policy-related question. Do NOT use this tool for questions about promotions, discounts, or promo codes — promotion information is provided in the system context under Active Promotions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The policy question (e.g., "What is the return policy?", "How long does shipping take?")',
        },
        context: {
          type: 'string',
          description: 'Conversation context for better answers',
        },
      },
      required: ['query', 'context'],
    },
  },
  {
    name: 'lookup_order',
    description:
      'Look up a customer order by order number. REQUIRES both the order number AND the customer email or phone number for identity verification. Always ask the customer for both before calling this tool. Never call without verification info.',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_number: {
          type: 'string',
          description: 'The order number (e.g., "1001" or "#1001")',
        },
        email: {
          type: 'string',
          description: 'Customer email address for identity verification',
        },
        phone: {
          type: 'string',
          description: 'Customer phone number for identity verification',
        },
      },
      required: ['order_number'],
    },
  },
  {
    name: 'check_return_eligibility',
    description:
      'Check which items from a verified order are eligible for return. Use after a successful order lookup when the customer wants to return something. Returns each item with eligibility status and reason.',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: {
          type: 'string',
          description: 'The Shopify order GID from a previous lookup_order result',
        },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'initiate_return',
    description:
      'Submit a return request for specific line items. Use after the customer confirms which items to return and provides a reason. Creates a return request for manual review.',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: {
          type: 'string',
          description: 'The Shopify order GID',
        },
        line_item_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of line item IDs to return',
        },
        reason: {
          type: 'string',
          description: 'Customer reason for the return',
        },
      },
      required: ['order_id', 'line_item_ids', 'reason'],
    },
  },
  {
    name: 'search_knowledge_base',
    description:
      'Search the internal knowledge base for brand-specific information not covered by standard Shopify policies. Use for questions about the brand, detailed guides, sizing info, care instructions, or other specialized knowledge.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query for the knowledge base',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'manage_cart',
    description:
      'Create a new cart, add items, remove items, update quantities, or apply discount codes. Use when the customer wants to add something to their cart or manage cart contents. Omit cart_id to create a new cart.',
    input_schema: {
      type: 'object' as const,
      properties: {
        cart_id: {
          type: 'string',
          description: 'Existing cart ID. Omit to create a new cart.',
        },
        add_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              product_variant_id: { type: 'string', description: 'Product variant GID (e.g., "gid://shopify/ProductVariant/123")' },
              quantity: { type: 'number', description: 'Quantity to add' },
            },
            required: ['product_variant_id', 'quantity'],
          },
          description: 'Items to add to cart',
        },
        update_items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Cart line ID' },
              quantity: { type: 'number', description: 'New quantity' },
            },
            required: ['id', 'quantity'],
          },
          description: 'Cart lines to update',
        },
        remove_line_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Cart line IDs to remove',
        },
        discount_codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Discount codes to apply',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_cart',
    description:
      'Get the current contents of a customer cart including items, totals, and checkout URL. Use when the customer asks about their cart or before confirming checkout.',
    input_schema: {
      type: 'object' as const,
      properties: {
        cart_id: {
          type: 'string',
          description: 'The cart ID to retrieve',
        },
      },
      required: ['cart_id'],
    },
  },
  {
    name: 'navigate_customer',
    description:
      'Suggest a page for the customer to visit by generating a clickable link/button in the chat. Use to direct customers to specific collections, products, or pages on the store.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL or relative path (e.g., "/collections/sale", "/pages/size-guide")',
        },
        label: {
          type: 'string',
          description: 'Button text (e.g., "View Sale Collection", "See Size Guide")',
        },
      },
      required: ['url', 'label'],
    },
  },
  {
    name: 'cancel_order',
    description:
      'Cancel an unfulfilled order. ONLY use after: (1) identity is verified via lookup_order, (2) order fulfillment status is UNFULFILLED, (3) customer has explicitly confirmed they want to cancel. If order is partially or fully fulfilled, do NOT call this tool — direct the customer to email support@outlight.us instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: {
          type: 'string',
          description: 'The Shopify order GID from a previous lookup_order result (e.g., "gid://shopify/Order/123456789")',
        },
        order_name: {
          type: 'string',
          description: 'The order display number (e.g., "#1042")',
        },
      },
      required: ['order_id', 'order_name'],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Mark the conversation as needing human attention and direct the customer to email support. There is NO live chat and NO priority levels. This tool flags the conversation internally and the customer should be directed to email support@outlight.us for a response within 1-2 business days.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: {
          type: 'string',
          description: 'Why the conversation is being escalated',
        },
      },
      required: ['reason'],
    },
  },
];
