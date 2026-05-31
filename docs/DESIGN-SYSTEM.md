# supportOS Design System

The single source of truth for the admin console's look. Defined in
`apps/admin/src/app/globals.css`; consumed via tokens + the primitives in
`apps/admin/src/components/ui/`. Goal: no hardcoded colors in pages — a rebrand
changes tokens in one place and propagates everywhere.

## Tokens (`globals.css`)

**Brand / accent** (re-themed per brand via `[data-brand]`):
`--color-accent`, `--color-accent-strong`, `--color-accent-light`,
`--color-accent-foreground`, `--color-accent-subtle`.

**Semantic feedback:** `--color-success`, `--color-warning`, `--color-danger`,
`--color-info`, `--color-star`.

**Status / priority / source** (used by `StatusPill`):
`--color-status-{open,pending,resolved,closed}`,
`--color-priority-{urgent,high,medium,low}`,
`--color-source-{email,form,ai}`.

**Surfaces (light/dark via `:root` / `.dark`):** `--bg-{primary,secondary,tertiary,hover}`,
`--border-{primary,secondary}`, `--text-{primary,secondary,tertiary}`, `--shadow-{sm,md}`.

**Scale:** `--spacing-1..16`, `--radius-{sm,md,lg,xl,full}`, `--text-{xs..3xl}`,
`--font-weight-{normal..bold}`, `--ease-out`, `--duration-{fast,base}`.

## Per-brand theming

`globals.css` defines `[data-brand="outlight|warm-by-design|misu"]` blocks that
override `--color-accent*`. `BrandProvider` (`components/brand-context.tsx`) sets
`document.documentElement.dataset.brand` from the session, so the whole OS
re-skins to the active brand's accent.

**DB-driven override (config, not fork):** set `brands.settings.console_accent` to
either a hex string or `{ accent, strong?, light?, foreground? }`. The dashboard
layout reads it server-side and `BrandProvider` applies it as inline CSS vars,
overriding the `[data-brand]` default — so a 4th brand themes the console from
config with no code change. Absent → falls back to the `[data-brand]` block.

## Component classes

`.ds-pill` (token-tinted badge, set `--pill-color`), `.ds-btn` +
`.ds-btn--{primary,secondary,ghost,danger}` + `.ds-btn--sm`, `.ds-card`.

## Primitives (`components/ui/`)

- **`<Button variant size leadingIcon>`** — `primary` uses the brand accent.
- **`<StatusPill kind value label? icon? />`** — the one place semantic status
  colors live. Kinds: `status`, `priority`, `source`, `classification`,
  `return`, `review`, `trade`, `member`, `conversation`, `product`, `reviewEmail`.
- **`statusColor(kind, value)`** — token color string for non-pill spots
  (status-tinted banners/borders/dots on detail pages).

## Adding / migrating a page (recipe)

1. Delete any local `*_STYLES` / `*_COLORS` color object.
2. Import `StatusPill` (and `Button`); render badges as `<StatusPill kind=… value=… />`.
   New taxonomy? Add a `kind` to `StatusPill`'s `TOKENS`.
3. For banners/borders that need the raw color, use `statusColor(kind, value)`.
4. Replace stray `#hex` / `rgba()` with `var(--color-*)` / `var(--text-*)` /
   `var(--bg-*)`; soft tints via `color-mix(in srgb, var(--token) 12%, transparent)`.
5. `npx tsc --noEmit` then `npx next build` before committing.

> Intentionally exempt: `funnel/products` `MOOD_COLORS` — a curated quiz-aesthetic
> palette, not status indicators.
