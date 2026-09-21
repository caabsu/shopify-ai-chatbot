export type SupportModelTier = 'flash' | 'pro';

export interface SupportToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AdminSupportGeneration {
  provider: string;
  access_provider: 'vercel-ai-gateway';
  model: string;
  requested_model: string;
  tier: SupportModelTier;
  thinking: 'disabled' | 'high';
  request_id?: string;
  response_id?: string;
  latency_ms: number;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    cached_input_tokens?: number;
  };
  cost_usd?: number;
}

export interface AdminSupportToolResult<T> {
  value: T;
  generation: AdminSupportGeneration;
}

export interface AdminSupportChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface AdminSupportAgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AdminSupportAgentStep {
  text: string;
  toolCalls: AdminSupportAgentToolCall[];
  assistantMessage: AdminSupportChatMessage;
  generation: AdminSupportGeneration;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
}

function configuredAccess(): AdminSupportGeneration['access_provider'] {
  const configured = (process.env.AUTOPILOT_AI_PROVIDER || 'vercel-ai-gateway').trim().toLowerCase();
  if (!['auto', 'vercel', 'gateway', 'vercel-ai-gateway'].includes(configured)) {
    throw new Error(
      `Admin AI only supports DeepSeek V4 through Vercel AI Gateway; received AUTOPILOT_AI_PROVIDER="${configured}"`,
    );
  }
  if (!process.env.AI_GATEWAY_API_KEY?.trim()) {
    throw new Error(
      'AI_GATEWAY_API_KEY is required for admin DeepSeek V4 requests; legacy model fallback is disabled',
    );
  }
  return 'vercel-ai-gateway';
}

export function ticketSupportModelTier(text: string, triageIntent?: string): SupportModelTier {
  if (['cancel_order', 'return_refund', 'address_change', 'damaged_item', 'order_modification'].includes(triageIntent ?? '')) {
    return 'pro';
  }
  return /\b(?:cancel(?:lation)?|refund|return|exchange|address change|change (?:my|the) address|modify (?:my|the) order|damaged|defective|wrong item|chargeback|fraud|legal|policy exception)\b/i
    .test(text)
    ? 'pro'
    : 'flash';
}

function parseOpenAiToolCall<T>(
  body: Record<string, unknown>,
  tool: SupportToolDefinition,
): T {
  const choice = Array.isArray(body.choices) && isRecord(body.choices[0]) ? body.choices[0] : {};
  const message = isRecord(choice.message) ? choice.message : {};
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls.filter(isRecord) : [];
  const selected = calls.find((call) => isRecord(call.function) && call.function.name === tool.name);
  if (!selected || !isRecord(selected.function)) throw new Error(`Model omitted required tool "${tool.name}"`);
  const args = selected.function.arguments;
  if (isRecord(args)) return args as T;
  if (typeof args !== 'string') throw new Error(`Model returned no arguments for "${tool.name}"`);
  const parsed: unknown = JSON.parse(args);
  if (!isRecord(parsed)) throw new Error(`Model returned invalid arguments for "${tool.name}"`);
  return parsed as T;
}

function requestedModel(tier: SupportModelTier): string {
  return tier === 'pro'
    ? process.env.AUTOPILOT_PRO_MODEL?.trim() || 'deepseek/deepseek-v4-pro'
    : process.env.AUTOPILOT_FLASH_MODEL?.trim() || 'deepseek/deepseek-v4.1-flash';
}

function parseAgentToolCalls(body: Record<string, unknown>): {
  text: string;
  toolCalls: AdminSupportAgentToolCall[];
  assistantMessage: AdminSupportChatMessage;
} {
  const choice = Array.isArray(body.choices) && isRecord(body.choices[0]) ? body.choices[0] : {};
  const message = isRecord(choice.message) ? choice.message : {};
  const content = typeof message.content === 'string' ? message.content : '';
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls.filter(isRecord) : [];
  const toolCalls = rawCalls.map((call, index) => {
    const fn = isRecord(call.function) ? call.function : {};
    const name = stringValue(fn.name);
    if (!name) throw new Error('Support model returned a tool call without a function name');
    const rawArguments = fn.arguments;
    let parsed: unknown;
    if (isRecord(rawArguments)) {
      parsed = rawArguments;
    } else if (typeof rawArguments === 'string') {
      parsed = JSON.parse(rawArguments);
    } else {
      throw new Error(`Support model returned no arguments for "${name}"`);
    }
    if (!isRecord(parsed)) throw new Error(`Support model returned invalid arguments for "${name}"`);
    return {
      id: stringValue(call.id) ?? `tool-call-${index}`,
      name,
      input: parsed,
    };
  });
  return {
    text: content,
    toolCalls,
    assistantMessage: {
      role: 'assistant',
      content: content || null,
      ...(toolCalls.length > 0 ? {
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.input),
          },
        })),
      } : {}),
    },
  };
}

async function callAdminDeepSeek(input: {
  tier: SupportModelTier;
  system: string;
  messages: AdminSupportChatMessage[];
  tools: SupportToolDefinition[];
  maxTokens: number;
  temperature?: number;
  requiredToolName?: string;
}): Promise<{ body: Record<string, unknown>; generation: AdminSupportGeneration }> {
  const access = configuredAccess();
  const model = requestedModel(input.tier);
  const baseUrl = (process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh/v1').replace(/\/+$/, '');
  const requestBody: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: input.system },
      ...input.messages,
    ],
    max_tokens: input.maxTokens,
    tools: input.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    })),
    tool_choice: input.requiredToolName
      ? { type: 'function', function: { name: input.requiredToolName } }
      : 'auto',
    parallel_tool_calls: false,
    reasoning: { effort: input.tier === 'pro' ? 'high' : 'none', exclude: true },
    providerOptions: {
      gateway: {
        sort: 'cost',
        disallowPromptTraining: process.env.AUTOPILOT_GATEWAY_DISALLOW_TRAINING !== 'false',
        zeroDataRetention: process.env.AUTOPILOT_GATEWAY_ZDR === 'true',
      },
    },
  };
  if (input.tier === 'flash') requestBody.temperature = input.temperature ?? 0.2;

  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(90_000),
  });
  const requestId = stringValue(
    response.headers.get('x-vercel-ai-gateway-request-id'),
    response.headers.get('x-request-id'),
  );
  if (!response.ok) {
    throw new Error(`DeepSeek V4 through Vercel AI Gateway returned HTTP ${response.status}`);
  }
  const decoded: unknown = await response.json();
  if (!isRecord(decoded)) throw new Error('DeepSeek V4 through Vercel AI Gateway returned invalid JSON');
  const usage = isRecord(decoded.usage) ? decoded.usage : {};
  const promptDetails = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const completionDetails = isRecord(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
  const providerMetadata = isRecord(decoded.provider_metadata) ? decoded.provider_metadata : {};
  const gatewayMetadata = isRecord(providerMetadata.gateway) ? providerMetadata.gateway : {};
  return {
    body: decoded,
    generation: {
      provider: stringValue(decoded.provider, gatewayMetadata.provider) ?? access,
      access_provider: access,
      model: stringValue(decoded.model) ?? model,
      requested_model: model,
      tier: input.tier,
      thinking: input.tier === 'pro' ? 'high' : 'disabled',
      request_id: requestId,
      response_id: stringValue(decoded.id),
      latency_ms: Date.now() - startedAt,
      usage: {
        input_tokens: finite(usage.prompt_tokens),
        output_tokens: finite(usage.completion_tokens),
        reasoning_tokens: finite(completionDetails.reasoning_tokens),
        cached_input_tokens: finite(promptDetails.cached_tokens ?? usage.prompt_cache_hit_tokens),
      },
      cost_usd: finite(gatewayMetadata.cost),
    },
  };
}

export async function callAdminSupportTool<T>(input: {
  tier: SupportModelTier;
  system: string;
  user: string;
  tool: SupportToolDefinition;
  maxTokens: number;
  temperature?: number;
}): Promise<AdminSupportToolResult<T>> {
  const result = await callAdminDeepSeek({
    tier: input.tier,
    system: input.system,
    messages: [{ role: 'user', content: input.user }],
    tools: [input.tool],
    maxTokens: input.maxTokens,
    temperature: input.temperature,
    requiredToolName: input.tool.name,
  });
  return {
    value: parseOpenAiToolCall<T>(result.body, input.tool),
    generation: result.generation,
  };
}

export async function callAdminSupportAgentStep(input: {
  tier: SupportModelTier;
  system: string;
  messages: AdminSupportChatMessage[];
  tools: SupportToolDefinition[];
  maxTokens: number;
  temperature?: number;
}): Promise<AdminSupportAgentStep> {
  const result = await callAdminDeepSeek(input);
  return {
    ...parseAgentToolCalls(result.body),
    generation: result.generation,
  };
}
