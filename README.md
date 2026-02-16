# Shopify AI Customer Support Chatbot

AI-powered customer support chatbot for Shopify stores. Uses Claude AI with tool-use to handle product searches, order tracking, returns, policy questions, and more.

## Architecture

- **Backend** — Node.js + Express + TypeScript. Orchestrates Claude AI conversations, integrates with Shopify Admin API and Storefront MCP, stores data in Supabase. Deployed on Railway.
- **Widget** — Lightweight vanilla JS/CSS chat widget embedded on the Shopify storefront via script tag.

## Setup

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in credentials
3. `npm install` from the root
4. `npm run dev:backend` to start the backend
5. `npm run dev:widget` to start the widget dev server

## Environment Variables

See `.env.example` for the full list.

## Deployment

- Backend deploys to Railway
- Widget JS/CSS served as static assets from the backend
- Add `<script src="https://YOUR-RAILWAY-DOMAIN/widget/widget.js" defer></script>` to Shopify theme
