/**
 * Canonical brand token source of truth (Stage 5 of the overhaul).
 *
 * Each brand's core palette lives here once. The same values are currently
 * mirrored across three independent build systems — this module is the reference
 * they should agree with, and is consumed directly by the admin (see
 * loadThemeAccent in (dashboard)/layout.tsx) as the per-brand accent fallback:
 *
 *   - Admin (Tailwind):  apps/admin/src/app/globals.css  →  [data-brand] { --color-accent }
 *   - Outlight widget:   apps/widget/src/styles/widget.css  →  --aicb-gold / --aicb-primary
 *   - Warm widget:       apps/widget-warm/src/.../*.css  →  --wbd-accent
 *
 * NOTE: the widget CSS files still hardcode these values. Generating them from
 * this source (a small codegen/CSS-var step) is deferred until the storefront
 * widgets can be visually verified — see docs/PLATFORM-OVERHAUL.md (Stage 5).
 */

export interface BrandTokens {
  /** Primary accent — drives CTAs and the admin console accent. */
  accent: string;
  /** Darker accent for hover/pressed states. */
  accentStrong: string;
  /** Lighter accent tint. */
  accentLight: string;
  /** Readable foreground on top of the accent. */
  accentForeground: string;
}

export const BRAND_TOKENS: Record<string, BrandTokens> = {
  outlight: {
    accent: '#c5a059',
    accentStrong: '#a9843f',
    accentLight: '#d9bd86',
    accentForeground: '#1a1a1a',
  },
  'warm-by-design': {
    accent: '#f5bc70',
    accentStrong: '#e0a24f',
    accentLight: '#f8d199',
    accentForeground: '#131313',
  },
  misu: {
    accent: '#6366f1',
    accentStrong: '#4f46e5',
    accentLight: '#818cf8',
    accentForeground: '#ffffff',
  },
};

/** Canonical accent tokens for a brand slug, if known. */
export function brandTokensFor(slug: string | null | undefined): BrandTokens | null {
  return slug ? BRAND_TOKENS[slug] ?? null : null;
}
