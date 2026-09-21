import dotenv from 'dotenv';
import path from 'path';
import { existsSync } from 'fs';

// Load .env before reading any env vars — handles npm workspaces where cwd may be apps/backend
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'apps/backend/.env'),
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
    apiVersion: optionalEnv('SHOPIFY_API_VERSION', '2026-07'),
  },
  deepseek: {
    /**
     * `auto` prefers Vercel AI Gateway, then native DeepSeek. There is
     * deliberately no legacy-provider fallback.
     */
    provider: optionalEnv('AUTOPILOT_AI_PROVIDER', 'auto'),
    gatewayApiKey: optionalEnv('AI_GATEWAY_API_KEY', ''),
    gatewayBaseUrl: optionalEnv('AI_GATEWAY_BASE_URL', 'https://ai-gateway.vercel.sh/v1'),
    nativeApiKey: optionalEnv('DEEPSEEK_API_KEY', ''),
    nativeBaseUrl: optionalEnv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1'),
    flashModel: optionalEnv('AUTOPILOT_FLASH_MODEL', 'deepseek/deepseek-v4.1-flash'),
    proModel: optionalEnv('AUTOPILOT_PRO_MODEL', 'deepseek/deepseek-v4-pro'),
    nativeFlashModel: optionalEnv('AUTOPILOT_NATIVE_FLASH_MODEL', 'deepseek-flash'),
    nativeProModel: optionalEnv('AUTOPILOT_NATIVE_PRO_MODEL', 'deepseek-v4-pro'),
    requestTimeoutMs: parseInt(optionalEnv('AUTOPILOT_AI_TIMEOUT_MS', '180000'), 10),
    gatewayZeroDataRetention: optionalEnv('AUTOPILOT_GATEWAY_ZDR', 'false') === 'true',
    gatewayDisallowTraining: optionalEnv('AUTOPILOT_GATEWAY_DISALLOW_TRAINING', 'true') !== 'false',
  },
  supabase: {
    url: requireEnv('SUPABASE_URL'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
  },
  ai: {
    maxTokens: parseInt(optionalEnv('AI_MAX_TOKENS', '4096'), 10),
    temperature: parseFloat(optionalEnv('AI_TEMPERATURE', '0.7')),
  },
  server: {
    port: parseInt(optionalEnv('PORT', '3001'), 10),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    corsOrigin: optionalEnv('CORS_ORIGIN', '*'),
  },
  email: {
    resendApiKey: optionalEnv('RESEND_API_KEY', ''),
    fromAddress: optionalEnv('EMAIL_FROM_ADDRESS', 'Support <onboarding@resend.dev>'),
  },
  gemini: {
    apiKey: optionalEnv('GEMINI_API_KEY', ''),
    reviewModel: optionalEnv('GEMINI_REVIEW_MODEL', 'gemini-3.1-flash-lite-preview'),
    imageModel: optionalEnv('GEMINI_IMAGE_MODEL', 'gemini-3.1-flash-image-preview'),
  },
} as const;
