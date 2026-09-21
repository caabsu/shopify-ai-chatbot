import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  DeepSeekChatCompletionRequest,
  DeepSeekChatCompletionResult,
  DeepSeekGenerationMetadata,
  DeepSeekToolCallClient,
  RequiredToolDefinition,
} from './deepseek-tool-call.service.js';
import { runStorefrontToolLoop } from './storefront-tool-loop.service.js';

const tool: RequiredToolDefinition = {
  name: 'lookup_order',
  description: 'Look up an order.',
  inputSchema: { type: 'object' },
};

function generation(
  tier: 'flash' | 'pro',
  inputTokens = 10,
  outputTokens = 2,
): DeepSeekGenerationMetadata {
  return {
    accessProvider: 'vercel-ai-gateway',
    actualProvider: 'deepinfra',
    requestedModel: tier === 'flash' ? 'deepseek/deepseek-v4.1-flash' : 'deepseek/deepseek-v4-pro',
    actualModel: tier === 'flash' ? 'deepseek/deepseek-v4.1-flash' : 'deepseek/deepseek-v4-pro',
    tier,
    thinking: tier === 'pro' ? 'high' : 'disabled',
    latencyMs: 12,
    usage: { inputTokens, outputTokens },
  };
}

function response(input: {
  tier: 'flash' | 'pro';
  text?: string;
  calls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  inputTokens?: number;
  outputTokens?: number;
}): DeepSeekChatCompletionResult {
  const calls = input.calls ?? [];
  return {
    text: input.text ?? '',
    toolCalls: calls.map((call) => ({
      ...call,
      rawArguments: JSON.stringify(call.arguments),
    })),
    assistantMessage: {
      role: 'assistant',
      content: input.text ?? null,
      ...(calls.length ? {
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: {
            name: call.name,
            arguments: JSON.stringify(call.arguments),
          },
        })),
      } : {}),
    },
    generation: generation(input.tier, input.inputTokens, input.outputTokens),
  };
}

function fakeClient(
  handler: (request: DeepSeekChatCompletionRequest, call: number) => DeepSeekChatCompletionResult,
): Pick<DeepSeekToolCallClient, 'callChatCompletion'> {
  let calls = 0;
  return {
    async callChatCompletion(request) {
      calls += 1;
      return handler(request, calls);
    },
  };
}

const flashRoute = {
  tier: 'flash' as const,
  thinking: 'disabled' as const,
  reasons: ['routine_or_read_only'],
  router_version: 'storefront-router-v1' as const,
};

test('routine text response stays on Flash and reports model usage', async () => {
  const result = await runStorefrontToolLoop({
    client: fakeClient((request) => {
      assert.equal(request.tier, 'flash');
      return response({ tier: 'flash', text: 'It is in stock.', inputTokens: 20, outputTokens: 5 });
    }),
    messages: [{ role: 'user', content: 'Is it in stock?' }],
    tools: [tool],
    route: flashRoute,
    maxTokens: 500,
    temperature: 0.2,
    executeTool: async () => ({ success: true }),
  });

  assert.equal(result.text, 'It is in stock.');
  assert.equal(result.finalTier, 'flash');
  assert.equal(result.tokensInput, 20);
  assert.equal(result.tokensOutput, 5);
  assert.equal(result.generations[0]?.actualModel, 'deepseek/deepseek-v4.1-flash');
});

test('OpenAI assistant tool_calls are followed by one tool result message per call', async () => {
  const seen: DeepSeekChatCompletionRequest[] = [];
  const result = await runStorefrontToolLoop({
    client: fakeClient((request, call) => {
      seen.push(request);
      if (call === 1) {
        return response({
          tier: 'flash',
          calls: [
            { id: 'call_1', name: 'lookup_order', arguments: { order_number: '1042' } },
            { id: 'call_2', name: 'search_products', arguments: { query: 'lamp' } },
          ],
        });
      }
      return response({ tier: 'flash', text: 'Done.' });
    }),
    messages: [{ role: 'user', content: 'Check my order and find a lamp.' }],
    tools: [tool],
    route: flashRoute,
    maxTokens: 500,
    temperature: 0.2,
    executeTool: async (name) => ({ success: true, data: { name } }),
  });

  assert.equal(result.text, 'Done.');
  assert.deepEqual(result.toolsUsed, ['lookup_order', 'search_products']);
  assert.deepEqual(seen[1]?.messages.slice(-3).map((message) => message.role), [
    'assistant',
    'tool',
    'tool',
  ]);
  assert.equal(seen[1]?.messages.at(-2)?.tool_call_id, 'call_1');
  assert.equal(seen[1]?.messages.at(-1)?.tool_call_id, 'call_2');
});

test('Flash privileged proposal is replayed on Pro before execution', async () => {
  let executions = 0;
  const seen: DeepSeekChatCompletionRequest[] = [];
  const result = await runStorefrontToolLoop({
    client: fakeClient((request, call) => {
      seen.push(request);
      if (call <= 2) {
        return response({
          tier: call === 1 ? 'flash' : 'pro',
          calls: [{
            id: `cancel_${call}`,
            name: 'cancel_order',
            arguments: { order_id: 'gid://shopify/Order/1' },
          }],
        });
      }
      return response({ tier: 'pro', text: 'Your order is cancelled.' });
    }),
    messages: [{ role: 'user', content: 'Please help with order #1042.' }],
    tools: [tool],
    route: flashRoute,
    maxTokens: 500,
    temperature: 0.2,
    executeTool: async () => {
      executions += 1;
      return { success: true };
    },
  });

  assert.equal(seen[0]?.tier, 'flash');
  assert.equal(seen[1]?.tier, 'pro');
  assert.deepEqual(seen[1]?.messages, seen[0]?.messages);
  assert.equal(executions, 1);
  assert.equal(result.finalTier, 'pro');
  assert.ok(result.routeReasons.includes('privileged_tool_escalation'));
});

test('iteration limit stops a non-terminating tool loop and preserves totals', async () => {
  let executions = 0;
  const result = await runStorefrontToolLoop({
    client: fakeClient(() => response({
      tier: 'flash',
      calls: [{ id: `lookup_${executions}`, name: 'lookup_order', arguments: {} }],
      inputTokens: 7,
      outputTokens: 3,
    })),
    messages: [{ role: 'user', content: 'Track it.' }],
    tools: [tool],
    route: flashRoute,
    maxTokens: 500,
    temperature: 0.2,
    maxIterations: 2,
    executeTool: async () => {
      executions += 1;
      return { success: true };
    },
  });

  assert.equal(result.iterationLimitReached, true);
  assert.equal(result.iterations, 2);
  assert.equal(executions, 2);
  assert.equal(result.tokensInput, 14);
  assert.equal(result.tokensOutput, 6);
});
