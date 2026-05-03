-- Migration 005: Point Warm by Design reviews at the brand-specific bundle.
update brands
set settings = jsonb_set(
  settings,
  '{widgetUrls,reviews}',
  '"/widget/warm/reviews.js"'::jsonb,
  true
)
where slug = 'warm-by-design';
