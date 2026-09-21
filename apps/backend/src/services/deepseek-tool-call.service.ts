export const DEEPSEEK_TOOL_MODELS = {
  'vercel-ai-gateway': {
    flash: 'deepseek/deepseek-v4.1-flash',
    pro: 'deepseek/deepseek-v4-pro',
  },
  deepseek: {
    flash: 'deepseek-flash',
    pro: 'deepseek-v4-pro',
  },
} as const;

export type DeepSeekAccessProvider = keyof typeof DEEPSEEK_TOOL_MODELS;
export type DeepSeekModelTier = 'flash' | 'pro';
export type DeepSeekThinkingMode = 'disabled' | 'high';

export interface DeepSeekAssistantToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * OpenAI-compatible chat message used by both Vercel AI Gateway and native
 * DeepSeek. Assistant tool-call messages and matching `role: "tool"` results
 * allow callers to run a complete multi-turn tool loop.
 */
export interface DeepSeekToolMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: DeepSeekAssistantToolCall[];
}

export interface RequiredToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface GatewayRoutingOptions {
  /**
   * Cost sorting is the production default. Gateway health checks still
   * deprioritize an unhealthy provider before a request is sent.
   */
  sort?: 'cost' | 'ttft' | 'tps';
  only?: string[];
  zeroDataRetention?: boolean;
  disallowPromptTraining?: boolean;
}

export interface DeepSeekToolCallClientConfig {
  accessProvider: DeepSeekAccessProvider;
  apiKey: string;
  baseUrl?: string;
  models?: Partial<Record<DeepSeekModelTier, string>>;
  timeoutMs?: number;
  gateway?: GatewayRoutingOptions;
}

export interface DeepSeekToolCallRequest<T> {
  tier: DeepSeekModelTier;
  messages: DeepSeekToolMessage[];
  tool: RequiredToolDefinition;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /**
   * Optional application validator/decoder. The transport deliberately does
   * not retry validation failures; callers own a deterministic retry or tier
   * escalation policy.
   */
  parse?: (value: unknown) => T;
}

export interface DeepSeekChatCompletionRequest {
  tier: DeepSeekModelTier;
  messages: DeepSeekToolMessage[];
  tools?: RequiredToolDefinition[];
  toolChoice?: 'auto' | 'none' | { name: string };
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface NormalizedTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  totalTokens?: number;
}

export interface DeepSeekGenerationMetadata {
  accessProvider: DeepSeekAccessProvider;
  actualProvider?: string;
  requestedModel: string;
  actualModel: string;
  tier: DeepSeekModelTier;
  thinking: DeepSeekThinkingMode;
  requestId?: string;
  responseId?: string;
  finishReason?: string;
  latencyMs: number;
  usage: NormalizedTokenUsage;
  costUsd?: number;
}

export interface DeepSeekRequiredToolResult<T> {
  value: T;
  rawArguments: string;
  toolCallId?: string;
  generation: DeepSeekGenerationMetadata;
}

export interface DeepSeekChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments: string;
}

export interface DeepSeekChatCompletionResult {
  text: string;
  toolCalls: DeepSeekChatToolCall[];
  assistantMessage: DeepSeekToolMessage;
  generation: DeepSeekGenerationMetadata;
}

export type DeepSeekToolCallErrorCode =
  | 'invalid_config'
  | 'invalid_request'
  | 'request_aborted'
  | 'timeout'
  | 'http_error'
  | 'invalid_response'
  | 'missing_tool_call'
  | 'invalid_tool_arguments';

export class DeepSeekToolCallError extends Error {
  readonly code: DeepSeekToolCallErrorCode;
  readonly status?: number;
  readonly requestId?: string;

  constructor(
    code: DeepSeekToolCallErrorCode,
    message: string,
    options: { cause?: unknown; status?: number; requestId?: string } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'DeepSeekToolCallError';
    this.code = code;
    this.status = options.status;
    this.requestId = options.requestId;
  }
}

export interface DeepSeekToolCallClient {
  callChatCompletion(
    request: DeepSeekChatCompletionRequest,
  ): Promise<DeepSeekChatCompletionResult>;
  callRequiredTool<T = Record<string, unknown>>(
    request: DeepSeekToolCallRequest<T>,
  ): Promise<DeepSeekRequiredToolResult<T>>;
}

export interface DeepSeekToolCallDependencies {
  fetch?: typeof fetch;
  now?: () => number;
}

type UnknownRecord = Record<string, unknown>;

const DEFAULT_BASE_URLS: Record<DeepSeekAccessProvider, string> = {
  'vercel-ai-gateway': 'https://ai-gateway.vercel.sh/v1',
  deepseek: 'https://api.deepseek.com',
};

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_TOKENS = 2_500;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function headerValue(headers: Headers, ...names: string[]): string | undefined {
  return firstString(...names.map((name) => headers.get(name)));
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function configuredModel(
  config: DeepSeekToolCallClientConfig,
  tier: DeepSeekModelTier,
): string {
  return config.models?.[tier]?.trim() || DEEPSEEK_TOOL_MODELS[config.accessProvider][tier];
}

function requestIdFrom(headers: Headers, body?: UnknownRecord): string | undefined {
  return headerValue(
    headers,
    'x-vercel-ai-gateway-request-id',
    'x-ai-gateway-request-id',
    'x-request-id',
    'request-id',
  ) ?? firstString(body?.request_id, body?.requestId);
}

function getProviderMetadata(body: UnknownRecord): {
  providerMetadata?: UnknownRecord;
  gatewayMetadata?: UnknownRecord;
} {
  const providerMetadata = asRecord(body.provider_metadata) ?? asRecord(body.providerMetadata);
  return {
    providerMetadata,
    gatewayMetadata: asRecord(providerMetadata?.gateway),
  };
}

function normalizeUsage(body: UnknownRecord): NormalizedTokenUsage {
  const usage = asRecord(body.usage) ?? {};
  const promptDetails = asRecord(usage.prompt_tokens_details)
    ?? asRecord(usage.promptTokensDetails)
    ?? {};
  const completionDetails = asRecord(usage.completion_tokens_details)
    ?? asRecord(usage.completionTokensDetails)
    ?? {};

  return {
    inputTokens: firstNumber(
      usage.prompt_tokens,
      usage.input_tokens,
      usage.promptTokens,
      usage.inputTokens,
    ),
    outputTokens: firstNumber(
      usage.completion_tokens,
      usage.output_tokens,
      usage.completionTokens,
      usage.outputTokens,
    ),
    reasoningTokens: firstNumber(
      completionDetails.reasoning_tokens,
      completionDetails.reasoningTokens,
      usage.reasoning_tokens,
      usage.reasoningTokens,
    ),
    cachedInputTokens: firstNumber(
      promptDetails.cached_tokens,
      promptDetails.cachedTokens,
      usage.prompt_cache_hit_tokens,
      usage.cache_read_input_tokens,
      usage.cached_input_tokens,
      usage.cachedInputTokens,
    ),
    totalTokens: firstNumber(usage.total_tokens, usage.totalTokens),
  };
}

function normalizedCost(body: UnknownRecord, gatewayMetadata?: UnknownRecord): number | undefined {
  const usage = asRecord(body.usage);
  return firstNumber(
    gatewayMetadata?.cost,
    gatewayMetadata?.costUsd,
    gatewayMetadata?.cost_usd,
    usage?.cost,
    usage?.costUsd,
    usage?.cost_usd,
  );
}

function successfulGatewayAttempt(gatewayMetadata?: UnknownRecord): UnknownRecord | undefined {
  const routing = asRecord(gatewayMetadata?.routing);
  const attempts = asArray(gatewayMetadata?.attempts ?? routing?.attempts)
    .map(asRecord)
    .filter((item): item is UnknownRecord => item !== undefined);

  return [...attempts].reverse().find((attempt) => {
    if (attempt.success === true) return true;
    const status = firstNumber(attempt.statusCode, attempt.status_code);
    return status !== undefined && status >= 200 && status < 300;
  });
}

function buildGatewayOptions(config: DeepSeekToolCallClientConfig): UnknownRecord {
  const gateway = config.gateway;
  const options: UnknownRecord = {
    sort: gateway?.sort ?? 'cost',
  };

  if (gateway?.only?.length) options.only = gateway.only;
  if (gateway?.zeroDataRetention !== undefined) {
    options.zeroDataRetention = gateway.zeroDataRetention;
  }
  if (gateway?.disallowPromptTraining !== undefined) {
    options.disallowPromptTraining = gateway.disallowPromptTraining;
  }

  return options;
}

function validateChatRequest(request: DeepSeekChatCompletionRequest): void {
  if (!request.messages.length) {
    throw new DeepSeekToolCallError('invalid_request', 'At least one model message is required.');
  }
  if (request.tools?.some((tool) => !tool.name.trim())) {
    throw new DeepSeekToolCallError('invalid_request', 'Every tool must have a name.');
  }
  const requiredToolName = typeof request.toolChoice === 'object'
    ? request.toolChoice.name
    : undefined;
  if (requiredToolName && !request.tools?.some((tool) => tool.name === requiredToolName)) {
    throw new DeepSeekToolCallError(
      'invalid_request',
      `The required tool "${requiredToolName}" is not included in tools.`,
    );
  }
  if (request.maxTokens !== undefined && (!Number.isInteger(request.maxTokens) || request.maxTokens <= 0)) {
    throw new DeepSeekToolCallError('invalid_request', 'maxTokens must be a positive integer.');
  }
  if (
    request.temperature !== undefined
    && (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)
  ) {
    throw new DeepSeekToolCallError('invalid_request', 'temperature must be between 0 and 2.');
  }
}

function buildRequestBody(
  config: DeepSeekToolCallClientConfig,
  request: DeepSeekChatCompletionRequest,
): UnknownRecord {
  const requestedModel = configuredModel(config, request.tier);
  const body: UnknownRecord = {
    model: requestedModel,
    messages: request.messages,
    stream: false,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
  };

  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
    body.tool_choice = typeof request.toolChoice === 'object'
      ? {
          type: 'function',
          function: { name: request.toolChoice.name },
        }
      : request.toolChoice ?? 'auto';
    body.parallel_tool_calls = false;
  }

  if (config.accessProvider === 'vercel-ai-gateway') {
    body.reasoning = {
      effort: request.tier === 'pro' ? 'high' : 'none',
      exclude: true,
    };
    body.providerOptions = { gateway: buildGatewayOptions(config) };
  } else {
    body.thinking = {
      type: request.tier === 'pro' ? 'enabled' : 'disabled',
    };
    if (request.tier === 'pro') body.reasoning_effort = 'high';
  }

  // Sampling is useful only for the non-thinking path. Thinking providers may
  // reject or silently ignore temperature, so omit it for Pro.
  if (request.tier === 'flash') body.temperature = request.temperature ?? 0.2;

  return body;
}

function decodeToolArguments(
  toolName: string,
  value: unknown,
): { arguments: Record<string, unknown>; rawArguments: string } {
  if (typeof value === 'string') {
    try {
      const decoded: unknown = JSON.parse(value);
      if (!isRecord(decoded)) throw new Error('Expected a JSON object.');
      return { arguments: decoded, rawArguments: value };
    } catch (error) {
      throw new DeepSeekToolCallError(
        'invalid_tool_arguments',
        `The tool "${toolName}" returned malformed JSON arguments.`,
        { cause: error },
      );
    }
  }
  if (isRecord(value)) {
    return { arguments: value, rawArguments: JSON.stringify(value) };
  }
  throw new DeepSeekToolCallError(
    'invalid_tool_arguments',
    `The tool "${toolName}" returned no JSON arguments.`,
  );
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  return asArray(value)
    .map(asRecord)
    .map((part) => firstString(part?.text, part?.content) ?? '')
    .join('');
}

function parseChatCompletion(body: UnknownRecord): {
  text: string;
  toolCalls: DeepSeekChatToolCall[];
  assistantMessage: DeepSeekToolMessage;
  finishReason?: string;
} {
  const choice = asRecord(asArray(body.choices)[0]);
  const message = asRecord(choice?.message);
  if (!choice || !message) {
    throw new DeepSeekToolCallError(
      'invalid_response',
      'The model response did not include an assistant choice.',
    );
  }

  const toolCalls: DeepSeekChatToolCall[] = asArray(message.tool_calls)
    .map(asRecord)
    .filter((item): item is UnknownRecord => item !== undefined)
    .map((item, index) => {
      const fn = asRecord(item.function);
      const name = firstString(fn?.name);
      if (!name) {
        throw new DeepSeekToolCallError(
          'invalid_response',
          'The model returned a tool call without a function name.',
        );
      }
      const decoded = decodeToolArguments(name, fn?.arguments);
      return {
        id: firstString(item.id) ?? `tool_call_${index + 1}`,
        name,
        arguments: decoded.arguments,
        rawArguments: decoded.rawArguments,
      };
    });

  // Accept the deprecated singular function_call response shape used by some
  // OpenAI-compatible providers, while normalizing it into one tool call.
  if (toolCalls.length === 0) {
    const legacy = asRecord(message.function_call);
    const legacyName = firstString(legacy?.name);
    if (legacyName) {
      const decoded = decodeToolArguments(legacyName, legacy?.arguments);
      toolCalls.push({
        id: 'function_call_1',
        name: legacyName,
        arguments: decoded.arguments,
        rawArguments: decoded.rawArguments,
      });
    }
  }

  const text = contentText(message.content);
  const assistantToolCalls: DeepSeekAssistantToolCall[] | undefined = toolCalls.length
    ? toolCalls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.name,
          arguments: toolCall.rawArguments,
        },
      }))
    : undefined;

  return {
    text,
    toolCalls,
    assistantMessage: {
      role: 'assistant',
      content: text || null,
      ...(assistantToolCalls ? { tool_calls: assistantToolCalls } : {}),
    },
    finishReason: firstString(choice.finish_reason, choice.finishReason),
  };
}

function generationMetadata(input: {
  config: DeepSeekToolCallClientConfig;
  tier: DeepSeekModelTier;
  requestedModel: string;
  response: Response;
  body: UnknownRecord;
  latencyMs: number;
  finishReason?: string;
}): DeepSeekGenerationMetadata {
  const { providerMetadata, gatewayMetadata } = getProviderMetadata(input.body);
  const successfulAttempt = successfulGatewayAttempt(gatewayMetadata);
  const actualProvider = headerValue(
    input.response.headers,
    'x-vercel-ai-gateway-provider',
    'x-ai-gateway-provider',
    'x-vercel-ai-provider',
  ) ?? firstString(
    input.body.provider,
    gatewayMetadata?.provider,
    gatewayMetadata?.providerName,
    providerMetadata?.provider,
    successfulAttempt?.provider,
  );
  const actualModel = headerValue(
    input.response.headers,
    'x-vercel-ai-gateway-model',
    'x-ai-gateway-model',
    'x-vercel-ai-model',
  ) ?? firstString(
    input.body.model,
    successfulAttempt?.model,
    successfulAttempt?.modelId,
    successfulAttempt?.model_id,
  ) ?? input.requestedModel;

  return {
    accessProvider: input.config.accessProvider,
    actualProvider,
    requestedModel: input.requestedModel,
    actualModel,
    tier: input.tier,
    thinking: input.tier === 'pro' ? 'high' : 'disabled',
    requestId: requestIdFrom(input.response.headers, input.body),
    responseId: firstString(input.body.id),
    finishReason: input.finishReason,
    latencyMs: input.latencyMs,
    usage: normalizeUsage(input.body),
    costUsd: normalizedCost(input.body, gatewayMetadata),
  };
}

async function readErrorResponse(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, 1_000);
  } catch {
    return '';
  }
}

export function createDeepSeekToolCallClient(
  config: DeepSeekToolCallClientConfig,
  dependencies: DeepSeekToolCallDependencies = {},
): DeepSeekToolCallClient {
  if (!config.apiKey.trim()) {
    throw new DeepSeekToolCallError('invalid_config', 'A DeepSeek or AI Gateway API key is required.');
  }
  if (config.timeoutMs !== undefined && (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)) {
    throw new DeepSeekToolCallError('invalid_config', 'timeoutMs must be greater than zero.');
  }

  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  if (!fetchImplementation) {
    throw new DeepSeekToolCallError('invalid_config', 'This runtime does not provide fetch.');
  }

  const now = dependencies.now ?? Date.now;
  const baseUrl = normalizeBaseUrl(config.baseUrl ?? DEFAULT_BASE_URLS[config.accessProvider]);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function callChatCompletion(
    request: DeepSeekChatCompletionRequest,
  ): Promise<DeepSeekChatCompletionResult> {
    validateChatRequest(request);

    const body = buildRequestBody(config, request);
    const requestedModel = configuredModel(config, request.tier);
    const controller = new AbortController();
    let didTimeout = false;

    const forwardAbort = () => controller.abort(request.signal?.reason);
    if (request.signal?.aborted) {
      forwardAbort();
    } else {
      request.signal?.addEventListener('abort', forwardAbort, { once: true });
    }

    const timer = setTimeout(() => {
      didTimeout = true;
      controller.abort(new Error(`Model request exceeded ${timeoutMs}ms.`));
    }, timeoutMs);
    const startedAt = now();

    try {
      const response = await fetchImplementation(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const responseRequestId = requestIdFrom(response.headers);
      if (!response.ok) {
        const details = await readErrorResponse(response);
        throw new DeepSeekToolCallError(
          'http_error',
          `The ${requestedModel} request returned HTTP ${response.status}${details ? `: ${details}` : '.'}`,
          { status: response.status, requestId: responseRequestId },
        );
      }

      let responseBody: UnknownRecord;
      try {
        const decoded: unknown = await response.json();
        if (!isRecord(decoded)) throw new Error('Expected a JSON object.');
        responseBody = decoded;
      } catch (error) {
        throw new DeepSeekToolCallError(
          'invalid_response',
          `The ${requestedModel} response was not a valid JSON object.`,
          { cause: error, requestId: responseRequestId },
        );
      }

      const parsed = parseChatCompletion(responseBody);
      return {
        text: parsed.text,
        toolCalls: parsed.toolCalls,
        assistantMessage: parsed.assistantMessage,
        generation: generationMetadata({
          config,
          tier: request.tier,
          requestedModel,
          response,
          body: responseBody,
          latencyMs: Math.max(0, now() - startedAt),
          finishReason: parsed.finishReason,
        }),
      };
    } catch (error) {
      if (didTimeout) {
        throw new DeepSeekToolCallError(
          'timeout',
          `The ${requestedModel} request timed out after ${timeoutMs}ms.`,
          { cause: error },
        );
      }
      if (controller.signal.aborted) {
        throw new DeepSeekToolCallError('request_aborted', 'The model request was aborted.', { cause: error });
      }
      if (error instanceof DeepSeekToolCallError) throw error;
      throw new DeepSeekToolCallError(
        'http_error',
        `The ${requestedModel} request failed before a response was received.`,
        { cause: error },
      );
    } finally {
      // Headers can arrive long before the model finishes its response body.
      // Keep the deadline and caller cancellation active through JSON decoding.
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', forwardAbort);
    }
  }

  return {
    callChatCompletion,
    async callRequiredTool<T>(
      request: DeepSeekToolCallRequest<T>,
    ): Promise<DeepSeekRequiredToolResult<T>> {
      if (!request.tool.name.trim()) {
        throw new DeepSeekToolCallError('invalid_request', 'The required tool must have a name.');
      }
      const response = await callChatCompletion({
        tier: request.tier,
        messages: request.messages,
        tools: [request.tool],
        toolChoice: { name: request.tool.name },
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        signal: request.signal,
      });
      const selected = response.toolCalls.find((toolCall) => toolCall.name === request.tool.name);
      if (!selected) {
        throw new DeepSeekToolCallError(
          'missing_tool_call',
          `The model did not call the required tool "${request.tool.name}" `
          + `(finish=${response.generation.finishReason ?? 'unknown'}, `
          + `output_tokens=${response.generation.usage.outputTokens ?? 'unknown'}, `
          + `reasoning_tokens=${response.generation.usage.reasoningTokens ?? 'unknown'}).`,
        );
      }

      let value: T;
      try {
        value = request.parse
          ? request.parse(selected.arguments)
          : selected.arguments as T;
      } catch (error) {
        if (error instanceof DeepSeekToolCallError) throw error;
        throw new DeepSeekToolCallError(
          'invalid_tool_arguments',
          `The required tool "${request.tool.name}" returned arguments that failed validation.`,
          { cause: error },
        );
      }

      return {
        value,
        rawArguments: selected.rawArguments,
        toolCallId: selected.id,
        generation: response.generation,
      };
    },
  };
}
