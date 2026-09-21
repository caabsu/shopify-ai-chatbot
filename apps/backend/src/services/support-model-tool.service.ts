import { config } from '../config/env.js';
import {
  createDeepSeekToolCallClient,
  type DeepSeekAccessProvider,
  type DeepSeekGenerationMetadata,
  type DeepSeekModelTier,
  type DeepSeekThinkingMode,
  type NormalizedTokenUsage,
  type RequiredToolDefinition,
  type DeepSeekToolCallClient,
} from './deepseek-tool-call.service.js';

export type SupportModelAccess = DeepSeekAccessProvider;

export interface SupportModelGeneration {
  /** Access layer used for the request. `rules` is deterministic, not an LLM. */
  access_provider: SupportModelAccess | 'rules';
  /** Actual inference provider when the access layer reports it. */
  provider: string;
  model: string;
  requested_model: string;
  tier: DeepSeekModelTier;
  thinking: DeepSeekThinkingMode;
  request_id?: string;
  response_id?: string;
  finish_reason?: string;
  latency_ms: number;
  usage: NormalizedTokenUsage;
  cost_usd?: number;
}

export interface SupportRequiredToolRequest<T> {
  tier: DeepSeekModelTier;
  system: string;
  user: string;
  tool: RequiredToolDefinition;
  max_tokens?: number;
  temperature?: number;
  parse?: (value: unknown) => T;
}

export interface SupportRequiredToolResult<T> {
  value: T;
  generation: SupportModelGeneration;
}

export interface SupportModelProviderInput {
  configuredProvider: string;
  gatewayApiKey: string;
  nativeApiKey: string;
}

export function resolveSupportModelAccess(input: SupportModelProviderInput): SupportModelAccess {
  const configured = input.configuredProvider.trim().toLowerCase();
  if (configured === 'vercel' || configured === 'gateway' || configured === 'vercel-ai-gateway') {
    if (!input.gatewayApiKey) throw new Error('AUTOPILOT_AI_PROVIDER requires AI_GATEWAY_API_KEY');
    return 'vercel-ai-gateway';
  }
  if (configured === 'deepseek' || configured === 'native') {
    if (!input.nativeApiKey) throw new Error('AUTOPILOT_AI_PROVIDER requires DEEPSEEK_API_KEY');
    return 'deepseek';
  }
  if (configured !== 'auto') {
    throw new Error(`Unsupported AUTOPILOT_AI_PROVIDER "${input.configuredProvider}"`);
  }
  if (input.gatewayApiKey) return 'vercel-ai-gateway';
  if (input.nativeApiKey) return 'deepseek';
  throw new Error(
    'DeepSeek is not configured. Set AI_GATEWAY_API_KEY or DEEPSEEK_API_KEY; '
    + 'cross-provider fallback is disabled.',
  );
}

export function currentSupportModelAccess(): SupportModelAccess {
  return resolveSupportModelAccess({
    configuredProvider: config.deepseek.provider,
    gatewayApiKey: config.deepseek.gatewayApiKey,
    nativeApiKey: config.deepseek.nativeApiKey,
  });
}

export function normalizeSupportModelGeneration(
  generation: DeepSeekGenerationMetadata,
): SupportModelGeneration {
  return {
    access_provider: generation.accessProvider,
    provider: generation.actualProvider ?? generation.accessProvider,
    model: generation.actualModel,
    requested_model: generation.requestedModel,
    tier: generation.tier,
    thinking: generation.thinking,
    request_id: generation.requestId,
    response_id: generation.responseId,
    finish_reason: generation.finishReason,
    latency_ms: generation.latencyMs,
    usage: generation.usage,
    cost_usd: generation.costUsd,
  };
}

export function createConfiguredDeepSeekClient(): DeepSeekToolCallClient {
  const access = currentSupportModelAccess();
  return createDeepSeekToolCallClient({
    accessProvider: access,
    apiKey: access === 'vercel-ai-gateway'
      ? config.deepseek.gatewayApiKey
      : config.deepseek.nativeApiKey,
    baseUrl: access === 'vercel-ai-gateway'
      ? config.deepseek.gatewayBaseUrl
      : config.deepseek.nativeBaseUrl,
    models: access === 'vercel-ai-gateway'
      ? {
          flash: config.deepseek.flashModel,
          pro: config.deepseek.proModel,
        }
      : {
          flash: config.deepseek.nativeFlashModel,
          pro: config.deepseek.nativeProModel,
        },
    timeoutMs: config.deepseek.requestTimeoutMs,
    gateway: access === 'vercel-ai-gateway' ? {
      sort: 'cost',
      zeroDataRetention: config.deepseek.gatewayZeroDataRetention,
      disallowPromptTraining: config.deepseek.gatewayDisallowTraining,
    } : undefined,
  });
}

/**
 * Shared support-model boundary. Callers own risk routing and the single
 * Flash-to-Pro escalation decision; this function performs exactly one request.
 */
export async function callSupportRequiredTool<T>(
  request: SupportRequiredToolRequest<T>,
): Promise<SupportRequiredToolResult<T>> {
  const result = await createConfiguredDeepSeekClient().callRequiredTool({
    tier: request.tier,
    messages: [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ],
    tool: request.tool,
    maxTokens: request.max_tokens,
    temperature: request.temperature,
    parse: request.parse,
  });
  return {
    value: result.value,
    generation: normalizeSupportModelGeneration(result.generation),
  };
}
