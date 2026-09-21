import type {
  DeepSeekChatCompletionResult,
  DeepSeekGenerationMetadata,
  DeepSeekModelTier,
  DeepSeekToolCallClient,
  DeepSeekToolMessage,
  RequiredToolDefinition,
} from './deepseek-tool-call.service.js';
import {
  storefrontToolRequiresPro,
  type StorefrontModelRoute,
} from './storefront-model-routing.js';

export interface StorefrontExecutedToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface StorefrontToolLoopResult {
  text: string;
  toolsUsed: string[];
  generations: DeepSeekGenerationMetadata[];
  finalTier: DeepSeekModelTier;
  routeReasons: string[];
  iterations: number;
  iterationLimitReached: boolean;
  tokensInput: number;
  tokensOutput: number;
}

export interface StorefrontToolLoopInput {
  client: Pick<DeepSeekToolCallClient, 'callChatCompletion'>;
  messages: DeepSeekToolMessage[];
  tools: RequiredToolDefinition[];
  route: StorefrontModelRoute;
  maxTokens: number;
  temperature: number;
  maxIterations?: number;
  executeTool: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<StorefrontExecutedToolResult>;
  onToolResult?: (
    name: string,
    result: StorefrontExecutedToolResult,
  ) => Promise<void> | void;
  onGeneration?: (
    response: DeepSeekChatCompletionResult,
    attempt: number,
    routeReasons: string[],
  ) => Promise<void> | void;
}

/**
 * Provider-neutral, OpenAI-compatible tool loop for storefront chat.
 *
 * Privileged calls proposed by Flash are never executed. The exact turn is
 * replayed on Pro, and only a Pro tool call can cross the side-effect boundary.
 */
export async function runStorefrontToolLoop(
  input: StorefrontToolLoopInput,
): Promise<StorefrontToolLoopResult> {
  const currentMessages = [...input.messages];
  const generations: DeepSeekGenerationMetadata[] = [];
  const toolsUsed: string[] = [];
  const routeReasons = [...input.route.reasons];
  const maxIterations = Math.max(1, input.maxIterations ?? 10);
  let tier = input.route.tier;
  let tokensInput = 0;
  let tokensOutput = 0;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const response = await input.client.callChatCompletion({
      tier,
      messages: currentMessages,
      tools: input.tools,
      toolChoice: 'auto',
      maxTokens: input.maxTokens,
      temperature: input.temperature,
    });
    generations.push(response.generation);
    tokensInput += response.generation.usage.inputTokens ?? 0;
    tokensOutput += response.generation.usage.outputTokens ?? 0;
    await input.onGeneration?.(response, iteration, routeReasons);

    if (response.toolCalls.length === 0) {
      return {
        text: response.text,
        toolsUsed: [...new Set(toolsUsed)],
        generations,
        finalTier: tier,
        routeReasons,
        iterations: iteration,
        iterationLimitReached: false,
        tokensInput,
        tokensOutput,
      };
    }

    if (
      tier === 'flash'
      && response.toolCalls.some((toolCall) => storefrontToolRequiresPro(toolCall.name))
    ) {
      tier = 'pro';
      if (!routeReasons.includes('privileged_tool_escalation')) {
        routeReasons.push('privileged_tool_escalation');
      }
      // Deliberately do not append the Flash tool proposal. Pro independently
      // reassesses the same state before any side effect can execute.
      continue;
    }

    currentMessages.push(response.assistantMessage);
    for (const toolCall of response.toolCalls) {
      toolsUsed.push(toolCall.name);
      const result = await input.executeTool(toolCall.name, toolCall.arguments);
      await input.onToolResult?.(toolCall.name, result);
      currentMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    text: '',
    toolsUsed: [...new Set(toolsUsed)],
    generations,
    finalTier: tier,
    routeReasons,
    iterations: maxIterations,
    iterationLimitReached: true,
    tokensInput,
    tokensOutput,
  };
}
