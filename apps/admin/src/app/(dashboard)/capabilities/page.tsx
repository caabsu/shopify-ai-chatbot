import { Wrench, ShoppingBag, Shield } from 'lucide-react';

const tools = [
  { name: 'search_products', desc: 'Search the store product catalog using natural language queries', source: 'Shopify MCP' },
  { name: 'get_product_details', desc: 'Get detailed product information including variants, pricing, and availability', source: 'Shopify MCP' },
  { name: 'answer_store_policy', desc: 'Answer questions about store policies (shipping, returns, refunds, FAQs)', source: 'Shopify MCP' },
  { name: 'lookup_order', desc: 'Look up customer orders by order number with email/phone verification', source: 'Shopify Admin API' },
  { name: 'check_return_eligibility', desc: 'Check which items from a verified order are eligible for return', source: 'Shopify Admin API' },
  { name: 'initiate_return', desc: 'Submit a return request for specific line items', source: 'Supabase' },
  { name: 'search_knowledge_base', desc: 'Search internal knowledge base for brand-specific information', source: 'Supabase' },
  { name: 'manage_cart', desc: 'Create/modify shopping carts, add items, apply discounts', source: 'Shopify MCP' },
  { name: 'get_cart', desc: 'Retrieve cart contents, totals, and checkout URL', source: 'Shopify MCP' },
  { name: 'navigate_customer', desc: 'Generate clickable navigation buttons to store pages', source: 'Internal' },
  { name: 'escalate_to_human', desc: 'Transfer conversation to a human agent', source: 'Internal' },
];

const scopes = [
  'read_orders', 'read_all_orders', 'read_products', 'read_customers', 'read_content',
  'read_shipping', 'read_inventory', 'read_fulfillments', 'write_returns',
  'read_discounts', 'write_discounts', 'read_legal_policies',
];

const services = [
  { name: 'Claude API', desc: 'AI model for conversation (claude-sonnet-4-20250514)' },
  { name: 'Shopify Storefront MCP', desc: 'Product search, policy lookup, cart management (JSON-RPC 2.0)' },
  { name: 'Shopify Admin API', desc: 'Order lookup, returns, customer data (GraphQL)' },
  { name: 'Supabase', desc: 'Database for conversations, messages, knowledge base, config' },
];

export default function CapabilitiesPage() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Capabilities</h2>

      {/* Tools */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Wrench size={16} />
          <h3 className="text-sm font-semibold">AI Tools ({tools.length})</h3>
        </div>
        <div className="space-y-3">
          {tools.map((t) => (
            <div key={t.name} className="flex items-start justify-between gap-4">
              <div>
                <code className="text-sm font-mono font-medium">{t.name}</code>
                <p className="text-xs text-gray-500 mt-0.5">{t.desc}</p>
              </div>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded flex-shrink-0">{t.source}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Shopify Scopes */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <ShoppingBag size={16} />
          <h3 className="text-sm font-semibold">Shopify API Scopes</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          {scopes.map((s) => (
            <code key={s} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">{s}</code>
          ))}
        </div>
      </div>

      {/* Connected Services */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Shield size={16} />
          <h3 className="text-sm font-semibold">Connected Services</h3>
        </div>
        <div className="space-y-3">
          {services.map((s) => (
            <div key={s.name}>
              <h4 className="text-sm font-medium">{s.name}</h4>
              <p className="text-xs text-gray-500">{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
