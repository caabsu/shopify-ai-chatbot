-- Minimal Warm by Design ticket-response knowledge base.
-- This keeps the initial AI support behavior brand-specific while the KB grows.

delete from public.knowledge_documents
where brand_id = 'b2f7e4a1-8c3d-4e5f-9a1b-2c3d4e5f6a7b'
  and title in (
    'Warm by Design support rules',
    'Warm by Design Shopify data rules',
    'Warm by Design product basics',
    'Warm by Design shipping and returns basics'
  );

insert into public.knowledge_documents (brand_id, title, category, priority, enabled, content)
values
  (
    'b2f7e4a1-8c3d-4e5f-9a1b-2c3d4e5f6a7b',
    'Warm by Design support rules',
    'support',
    100,
    true,
    'Warm by Design support must answer as Warm by Design only. Never mention Outlight in Warm by Design replies. Use support@warmbydesign.com as the support contact. Keep replies calm, concise, specific, and helpful. Do not invent specifications, policies, links, tracking URLs, or internal escalations. If exact product details are not available from Shopify or this knowledge base, say what is known and offer to confirm the missing detail.'
  ),
  (
    'b2f7e4a1-8c3d-4e5f-9a1b-2c3d4e5f6a7b',
    'Warm by Design Shopify data rules',
    'operations',
    90,
    true,
    'Warm by Design is connected to its own Shopify store at 1u8ryb-ym.myshopify.com. Customer profiles, order information, product catalog data, fulfillment status, and tracking data must come from the Warm by Design Shopify connection only. Do not use Outlight Shopify data for Warm by Design. For order help, use the customer email or order number and reference the current Shopify order status when it is available.'
  ),
  (
    'b2f7e4a1-8c3d-4e5f-9a1b-2c3d4e5f6a7b',
    'Warm by Design product basics',
    'products',
    80,
    true,
    'Warm by Design focuses on warm ambient lighting, commonly 2700K where listed. Use Shopify product data and metafields for exact product specifications such as color temperature, bulb base, voltage, materials, and included parts. For the Onyx lamp, Shopify currently shows: warm 2700K marble table lamp, E26 bulb base included, US compatible 120V, Emperador marble column, black fabric empire shade. No wattage is currently listed in the available Shopify data, so do not guess the wattage. If asked about wattage, say the available data shows E26 included and US-compatible 120V, but the wattage is not listed and the team should confirm before giving a number.'
  ),
  (
    'b2f7e4a1-8c3d-4e5f-9a1b-2c3d4e5f6a7b',
    'Warm by Design shipping and returns basics',
    'policies',
    70,
    true,
    'Use Shopify policy/FAQ data when answering detailed shipping or return questions. Current product FAQ data indicates many products ship free within the continental United States, tracking is sent after shipment, and customers generally have 30 days from delivery to request a return. Do not promise an exception, refund, exchange, cancellation, or return outcome unless Shopify order data or an internal instruction supports it.'
  );
