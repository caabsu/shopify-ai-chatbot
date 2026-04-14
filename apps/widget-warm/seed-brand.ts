import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BRAND_ID = 'b2f7e4a1-8c3d-4e5f-9a1b-2c3d4e5f6a7b';

async function seed() {
  // Insert brand
  const { data: brand, error: brandErr } = await supabase
    .from('brands')
    .upsert({
      id: BRAND_ID,
      slug: 'warm-by-design',
      name: 'Warm by Design',
      shopify_shop: 'warm-by-design',
      password_hash: '$2b$10$placeholder',
      enabled: true,
      settings: {
        domain: null,
        fonts: { heading: 'Bricolage Grotesque', body: 'Outfit', label: 'Syne' },
        colors: { surface: '#131313', cream: '#F0EDE8', amber: '#f5bc70', onPrimary: '#462b00' },
        theme: 'dark'
      }
    }, { onConflict: 'id' })
    .select()
    .single();

  if (brandErr) {
    console.error('Brand insert error:', brandErr.message);
    process.exit(1);
  }
  console.log('Brand created:', brand.name, brand.slug);

  // Insert ai_config entries
  const configs = [
    { key: 'system_prompt', value: 'You are a lighting expert for Warm by Design, a premium DTC ambient lighting brand. Every product is tuned to exactly 2700K — the color temperature of golden hour. You help customers find the right light for their space, track orders, process returns, and answer questions. You speak with intention and warmth. You are knowledgeable but never condescending — you assume the customer appreciates good design. Keep responses concise and helpful. Never push sales; guide with expertise.' },
    { key: 'brand_voice', value: 'Intentional, warm, restrained, considered, concise. Speak like an expert who assumes you get it — not an educator. Specific, not vague. Premium without performing premium.' },
    { key: 'greeting', value: 'Welcome. I can help you find the right light, check on an order, or answer any questions about our collection. What can I do for you?' },
    { key: 'preset_actions', value: JSON.stringify([
      { id: 'track_order', label: 'Track my order', icon: 'truck', prompt: 'I want to track my order' },
      { id: 'start_return', label: 'Start a return', icon: 'return', prompt: 'I want to start a return' },
      { id: 'find_lamp', label: 'Find a lamp', icon: 'search', prompt: 'Help me find the right lamp for my space' },
      { id: 'shipping_info', label: 'Shipping info', icon: 'help', prompt: 'What are your shipping options?' },
      { id: 'talk_to_human', label: 'Talk to a human', icon: 'contact', prompt: 'I want to talk to a real person' },
    ]) },
  ];

  for (const cfg of configs) {
    const { error } = await supabase
      .from('ai_config')
      .upsert({ key: cfg.key, value: cfg.value, brand_id: BRAND_ID }, { onConflict: 'key,brand_id' });
    if (error) console.error('ai_config error for', cfg.key, ':', error.message);
    else console.log('ai_config set:', cfg.key);
  }

  console.log('Done! Warm by Design brand is live.');
}

seed();
