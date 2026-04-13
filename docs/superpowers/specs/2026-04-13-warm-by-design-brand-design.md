# Warm by Design — Brand Integration Spec

## Summary

Add "Warm by Design" as a fully separate brand in the shopify-ai-chatbot system. This includes a standalone widget codebase (`apps/widget-warm/`) with chatbot and returns portal, plus backend brand configuration in Supabase.

## Locked Designs

- **Chatbot**: V2 Lantern — floating overlay with warm gradient header, amber glow avatar, preset chips, inline product cards
- **Returns Portal**: V1 Single Card — single `.ab`-bordered card with order lookup, item selection, reason, submit

## Widget Codebase (`apps/widget-warm/`)

Completely separate from the Outlight widget. Own source, styles, build.

### Structure

```
apps/widget-warm/
├── src/
│   ├── chatbot/
│   │   ├── chatbot.ts           # Entry, FAB + window init
│   │   ├── ui/
│   │   │   ├── ChatWindow.ts
│   │   │   ├── Header.ts        # Warm gradient, avatar, presets
│   │   │   ├── MessageList.ts   # Messages + inline product cards
│   │   │   ├── InputBar.ts
│   │   │   └── FloatingButton.ts
│   │   ├── api/client.ts
│   │   ├── state/store.ts
│   │   └── styles/chatbot.css
│   └── returns/
│       ├── returns.ts           # Entry, renders into target
│       ├── ui/
│       │   ├── ReturnsPortal.ts
│       │   ├── ItemSelector.ts
│       │   └── OrderLookup.ts
│       ├── api/client.ts
│       └── styles/returns.css
├── vite.config.ts               # Builds chatbot.js + returns.js
└── package.json
```

### Design System

| Token | Value |
|---|---|
| Surface | `#131313` |
| Surface container low | `#1c1b1b` |
| Surface container | `#201f1f` |
| Surface container high | `#2a2a2a` |
| Cream | `#F0EDE8` |
| Amber | `#f5bc70` |
| On-primary | `#462b00` |
| Border | `1px solid rgba(245,188,112,0.1)` |
| Border hover | `rgba(245,188,112,0.2)` |
| Border focus | `rgba(245,188,112,0.3)` |
| Corners | Sharp (0px border-radius) |

**Fonts**: Bricolage Grotesque (headlines), Outfit (body), Syne (labels)
**Icons**: Material Symbols Outlined

### Build

- Vite library mode, IIFE bundles
- CSS injected into JS (same pattern as Outlight widget)
- Outputs: `dist/chatbot.js`, `dist/returns.js`

## Backend Integration

### Brand Entry (Supabase `brands` table)

- `slug`: `warm-by-design`
- `name`: `Warm by Design`
- `shopify_shop`: TBD
- `enabled`: true
- `settings`: `{ domain, fonts, colors }`

### AI Config (Supabase `ai_config` table, filtered by brand_id)

- `system_prompt`: Warm by Design lighting expert prompt
- `brand_voice`: "Intentional, warm, restrained, considered, concise."
- `greeting`: "Welcome. I can help you find the right light, check on an order, or answer any questions about our collection."
- `preset_actions`: Track order, Start a return, Find a lamp, Shipping info, Talk to a human

### Serving

- `/widget/warm/chatbot.js` — static from `apps/widget-warm/dist/chatbot.js`
- `/widget/warm/returns.js` — static from `apps/widget-warm/dist/returns.js`
- `/widget/warm/playground` — test page

### Usage

```html
<script src="https://api.example.com/widget/warm/chatbot.js"></script>

<div id="returns-portal"></div>
<script src="https://api.example.com/widget/warm/returns.js" data-target="#returns-portal"></script>
```

## Shared vs. Separate

| Concern | Shared | Separate |
|---|---|---|
| Backend API endpoints | X | |
| AI service + tools | X | |
| Supabase tables | X | |
| Widget JS/CSS | | X |
| Design tokens | | X |
| Copy/messaging | | X |
