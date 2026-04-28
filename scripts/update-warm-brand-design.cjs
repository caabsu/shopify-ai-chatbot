const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const widgetDesign = {
  primaryColor: '#f5bc70',
  backgroundColor: '#1c1b1b',
  headerTitle: 'Warm by Design',
  position: 'bottom-right',
  bubbleIcon: 'chat',
  welcomeMessage: '',
  inputPlaceholder: 'Ask about lighting, orders, returns...',
  borderRadius: 'sharp',
  fontSize: 'medium',
  showBrandingBadge: true,
  autoOpenDelay: 0,
  greetingHeader: 'Every room deserves golden hour.',
  greetingSubtext: 'Ask us about products, orders, shipping, or returns.',
  headerSubtitle: 'Support',
  headerLogo: '',
  brandingText: 'Designed at 2700K',
  theme: 'dark',
  fontFamily: '"Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headingFontFamily: '"Bricolage Grotesque", sans-serif',
  headingFontWeight: '300',
};

const contactDesign = {
  primaryColor: '#f5bc70',
  backgroundColor: '#131313',
  inputBackground: 'rgba(19, 19, 19, 0.5)',
  borderColor: 'rgba(245, 188, 112, 0.1)',
  textColor: '#F0EDE8',
  labelColor: 'rgba(240, 237, 232, 0.45)',
  placeholderColor: 'rgba(240, 237, 232, 0.18)',
  accentColor: '#f5bc70',
  headingFontFamily: '"Bricolage Grotesque", sans-serif',
  bodyFontFamily: '"Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headingFontSize: '48px',
  labelFontSize: '12px',
  inputFontSize: '15px',
  cardBorderRadius: '0',
  inputBorderRadius: '0',
  buttonBorderRadius: '0',
  headerTitle: 'How can we help?',
  headerIcon: 'mail',
  nameLabel: 'Name',
  namePlaceholder: 'Your full name',
  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  subjectLabel: 'Subject',
  subjectPlaceholder: 'Order help, product question, or return',
  messageLabel: 'Message',
  messagePlaceholder: 'Tell us what you need help with...',
  buttonText: 'Send Message',
  buttonShowArrow: true,
  successMessage: "Message sent. We'll get back to you soon.",
  showSubjectField: true,
  cardPadding: 'clamp(24px, 4vw, 48px)',
};

const reviewDesign = {
  starColor: '#f5bc70',
  starStyle: 'filled',
  backgroundColor: '#131313',
  textColor: '#F0EDE8',
  headingColor: '#f5bc70',
  headingFontFamily: 'Bricolage Grotesque',
  bodyFontFamily: 'Outfit',
  fontSize: 'medium',
  borderRadius: 'sharp',
  cardStyle: 'bordered',
  buttonStyle: 'filled',
  buttonText: 'WRITE A REVIEW',
  headerText: 'CUSTOMER REVIEWS',
  reviewsPerPage: 10,
  defaultSort: 'newest',
  showVerifiedBadge: true,
  showVariant: true,
  showDate: true,
  showPhotos: true,
  layout: 'grid',
};

const returnDesign = {
  primaryColor: '#f5bc70',
  backgroundColor: 'transparent',
  cardBackgroundColor: '#1c1b1b',
  textColor: '#F0EDE8',
  mutedTextColor: 'rgba(240, 237, 232, 0.4)',
  borderRadius: 'sharp',
  fontSize: 'medium',
  fontFamily: '"Outfit", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  headingFontFamily: '"Bricolage Grotesque", sans-serif',
  buttonTextLookup: 'Look up order',
  buttonTextSubmit: 'Submit return request',
  successTitle: 'Return request submitted',
  successMessage: "We'll send instructions after we review your request.",
};

async function findWarmBrand() {
  const bySlug = await supabase
    .from('brands')
    .select('id, slug')
    .eq('slug', 'warm-by-design')
    .maybeSingle();

  if (bySlug.error) throw new Error(`Brand lookup failed: ${bySlug.error.message}`);
  if (bySlug.data) return bySlug.data;

  const byShop = await supabase
    .from('brands')
    .select('id, slug')
    .ilike('shopify_shop', '%1u8ryb-ym%')
    .maybeSingle();

  if (byShop.error) throw new Error(`Brand fallback lookup failed: ${byShop.error.message}`);
  if (byShop.data) return byShop.data;

  throw new Error('Warm by Design brand was not found');
}

async function upsertAiConfig(brandId, keyName, value) {
  const existing = await supabase
    .from('ai_config')
    .select('id')
    .eq('brand_id', brandId)
    .eq('key', keyName)
    .maybeSingle();

  if (existing.error) throw new Error(`ai_config lookup failed for ${keyName}: ${existing.error.message}`);

  if (existing.data) {
    const updated = await supabase
      .from('ai_config')
      .update({ value: JSON.stringify(value), updated_at: new Date().toISOString() })
      .eq('id', existing.data.id);
    if (updated.error) throw new Error(`ai_config update failed for ${keyName}: ${updated.error.message}`);
    return 'updated';
  }

  const inserted = await supabase
    .from('ai_config')
    .insert({ brand_id: brandId, key: keyName, value: JSON.stringify(value) });
  if (inserted.error) throw new Error(`ai_config insert failed for ${keyName}: ${inserted.error.message}`);
  return 'inserted';
}

async function upsertContactSettings(brandId) {
  const existing = await supabase
    .from('contact_form_settings')
    .select('id')
    .eq('brand_id', brandId)
    .maybeSingle();

  if (existing.error) throw new Error(`Contact settings lookup failed: ${existing.error.message}`);

  if (existing.data) {
    const updated = await supabase
      .from('contact_form_settings')
      .update({ widget_design: contactDesign, updated_at: new Date().toISOString() })
      .eq('id', existing.data.id);
    if (updated.error) throw new Error(`Contact settings update failed: ${updated.error.message}`);
    return 'updated';
  }

  const inserted = await supabase
    .from('contact_form_settings')
    .insert({
      brand_id: brandId,
      widget_design: contactDesign,
      form_config: {
        categories: ['general', 'order', 'shipping', 'return', 'other'],
        defaultCategory: 'general',
      },
    });
  if (inserted.error) throw new Error(`Contact settings insert failed: ${inserted.error.message}`);
  return 'inserted';
}

async function upsertReviewSettings(brandId) {
  const existing = await supabase
    .from('review_settings')
    .select('id')
    .eq('brand_id', brandId)
    .maybeSingle();

  if (existing.error) throw new Error(`Review settings lookup failed: ${existing.error.message}`);

  if (existing.data) {
    const updated = await supabase
      .from('review_settings')
      .update({ widget_design: reviewDesign, updated_at: new Date().toISOString() })
      .eq('id', existing.data.id);
    if (updated.error) throw new Error(`Review settings update failed: ${updated.error.message}`);
    return 'updated';
  }

  const inserted = await supabase
    .from('review_settings')
    .insert({ brand_id: brandId, widget_design: reviewDesign });
  if (inserted.error) throw new Error(`Review settings insert failed: ${inserted.error.message}`);
  return 'inserted';
}

async function updateReturnSettings(brandId) {
  const existing = await supabase
    .from('return_settings')
    .select('id')
    .eq('brand_id', brandId)
    .maybeSingle();

  if (existing.error) throw new Error(`Return settings lookup failed: ${existing.error.message}`);
  if (!existing.data) return 'missing';

  const updated = await supabase
    .from('return_settings')
    .update({
      portal_title: 'Start a return',
      portal_description: 'Look up an eligible Warm by Design order and send us the details.',
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.data.id);

  if (updated.error) throw new Error(`Return settings update failed: ${updated.error.message}`);
  return 'updated';
}

async function main() {
  const brand = await findWarmBrand();
  const result = {
    brand: brand.slug,
    contact: await upsertContactSettings(brand.id),
    reviews: await upsertReviewSettings(brand.id),
    returns: await updateReturnSettings(brand.id),
    widgetDesign: await upsertAiConfig(brand.id, 'widget_design', widgetDesign),
    returnDesign: await upsertAiConfig(brand.id, 'return_portal_design', returnDesign),
  };
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
