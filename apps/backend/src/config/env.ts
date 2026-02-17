import dotenv from 'dotenv';
import path from 'path';
import { existsSync } from 'fs';

// Load .env before reading any env vars — handles npm workspaces where cwd may be apps/backend
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
];
const envPath = envCandidates.find((p) => existsSync(p));
if (envPath) dotenv.config({ path: envPath });

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export const config = {
  shopify: {
    shop: requireEnv('SHOPIFY_SHOP'),
    clientId: requireEnv('SHOPIFY_CLIENT_ID'),
    clientSecret: requireEnv('SHOPIFY_CLIENT_SECRET'),
    apiVersion: optionalEnv('SHOPIFY_API_VERSION', '2025-01'),
  },
  anthropic: {
    apiKey: requireEnv('ANTHROPIC_API_KEY'),
  },
  supabase: {
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  },
  ai: {
    model: optionalEnv('AI_MODEL', 'claude-sonnet-4-20250514'),
    maxTokens: parseInt(optionalEnv('AI_MAX_TOKENS', '4096'), 10),
    temperature: parseFloat(optionalEnv('AI_TEMPERATURE', '0.7')),
  },
  server: {
    port: parseInt(optionalEnv('PORT', '3001'), 10),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    corsOrigin: optionalEnv('CORS_ORIGIN', '*'),
  },
} as const;
