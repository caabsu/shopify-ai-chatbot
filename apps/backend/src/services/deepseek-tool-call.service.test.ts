import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEEPSEEK_TOOL_MODELS,
  DeepSeekToolCallError,
  createDeepSeekToolCallClient,
  type RequiredToolDefinition,
} from './deepseek-tool-call.service.js';

const tool: RequiredToolDefinition = {
  name: 'propose_action_plan',
  description: 'Return a support action plan.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
    },
    required: ['summary'],
  },
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

test('Gateway Flash forces one tool, disables reasoning, and captures routing metadata', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  let calls = 0;
  const fakeFetch: typeof fetch = async (input, init) => {
    calls += 1;
    capturedUrl = String(input);
    capturedInit = init;
    return jsonResponse({
      id: 'chatcmpl_123',
      model: 'deepseek/deepseek-v4.1-flash',
      provider: 'deepinfra',
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          tool_calls: [{
            id: 'call_123',
            type: 'function',
            function: {
              name: tool.name,
              arguments: '{"summary":"routine reply"}',
            },
          }],
        },
      }],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 20 },
        completion_tokens_details: { reasoning_tokens: 0 },
      },
      provider_metadata: {
        gateway: {
          cost: '0.0000162',
          provider: 'deepinfra',
        },
      },
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-vercel-ai-gateway-request-id': 'gw_req_123',
      },
    });
  };

  const client = createDeepSeekToolCallClient({
    accessProvider: 'vercel-ai-gateway',
    apiKey: 'gateway-secret',
    gateway: {
      sort: 'cost',
      only: ['deepinfra', 'deepseek'],
      zeroDataRetention: true,
      disallowPromptTraining: true,
    },
  }, {
    fetch: fakeFetch,
    now: (() => {
      const values = [1_000, 1_035];
      return () => values.shift() ?? 1_035;
    })(),
  });

  const result = await client.callRequiredTool({
    tier: 'flash',
    messages: [
      { role: 'system', content: 'You draft support plans.' },
      { role: 'user', content: 'Where is my order?' },
    ],
    tool,
    parse(value) {
      assert.equal(typeof value, 'object');
      return value as { summary: string };
    },
  });

  assert.equal(calls, 1);
  assert.equal(capturedUrl, 'https://ai-gateway.vercel.sh/v1/chat/completions');
  assert.equal((capturedInit?.headers as Record<string, string>).Authorization, 'Bearer gateway-secret');

  const body = JSON.parse(String(capturedInit?.body)) as Record<string, any>;
  assert.equal(body.model, DEEPSEEK_TOOL_MODELS['vercel-ai-gateway'].flash);
  assert.deepEqual(body.reasoning, { effort: 'none', exclude: true });
  assert.equal(body.temperature, 0.2);
  assert.deepEqual(body.tool_choice, {
    type: 'function',
    function: { name: tool.name },
  });
  assert.equal(body.parallel_tool_calls, false);
  assert.deepEqual(body.tools[0].function.parameters, tool.inputSchema);
  assert.deepEqual(body.providerOptions.gateway, {
    sort: 'cost',
    only: ['deepinfra', 'deepseek'],
    zeroDataRetention: true,
    disallowPromptTraining: true,
  });

  assert.deepEqual(result.value, { summary: 'routine reply' });
  assert.equal(result.toolCallId, 'call_123');
  assert.deepEqual(result.generation, {
    accessProvider: 'vercel-ai-gateway',
    actualProvider: 'deepinfra',
    requestedModel: 'deepseek/deepseek-v4.1-flash',
    actualModel: 'deepseek/deepseek-v4.1-flash',
    tier: 'flash',
    thinking: 'disabled',
    requestId: 'gw_req_123',
    responseId: 'chatcmpl_123',
    finishReason: 'tool_calls',
    latencyMs: 35,
    usage: {
      inputTokens: 120,
      outputTokens: 30,
      reasoningTokens: 0,
      cachedInputTokens: 20,
      totalTokens: 150,
    },
    costUsd: 0.0000162,
  });
});

test('Gateway chat completion supports optional tools and OpenAI tool-result history', async () => {
  let body: Record<string, any> | undefined;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, any>;
    return jsonResponse({
      id: 'chatcmpl_storefront',
      model: 'deepseek/deepseek-v4.1-flash',
      choices: [{
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'Your order is in transit.' },
      }],
      usage: { prompt_tokens: 80, completion_tokens: 8, total_tokens: 88 },
    });
  };
  const client = createDeepSeekToolCallClient({
    accessProvider: 'vercel-ai-gateway',
    apiKey: 'gateway-secret',
  }, { fetch: fakeFetch });

  const result = await client.callChatCompletion({
    tier: 'flash',
    messages: [
      { role: 'user', content: 'Track order #1042.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'lookup_1',
          type: 'function',
          function: { name: 'lookup_order', arguments: '{"order_number":"1042"}' },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'lookup_1',
        content: '{"success":true,"status":"IN_TRANSIT"}',
      },
    ],
    tools: [tool],
    toolChoice: 'auto',
  });

  assert.equal(body?.tool_choice, 'auto');
  assert.equal(body?.messages[2].role, 'tool');
  assert.equal(body?.messages[2].tool_call_id, 'lookup_1');
  assert.deepEqual(body?.reasoning, { effort: 'none', exclude: true });
  assert.equal(result.text, 'Your order is in transit.');
  assert.deepEqual(result.toolCalls, []);
  assert.equal(result.generation.actualModel, 'deepseek/deepseek-v4.1-flash');
});

test('direct DeepSeek Pro enables thinking at high effort and parses native usage', async () => {
  let body: Record<string, any> | undefined;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, any>;
    return jsonResponse({
      id: 'native_1',
      model: 'deepseek-v4-pro',
      choices: [{
        finish_reason: 'tool_calls',
        message: {
          tool_calls: [{
            type: 'function',
            function: {
              name: tool.name,
              arguments: { summary: 'cancel after verification' },
            },
          }],
        },
      }],
      usage: {
        prompt_tokens: 500,
        completion_tokens: 100,
        total_tokens: 600,
        prompt_cache_hit_tokens: 300,
        completion_tokens_details: { reasoning_tokens: 70 },
      },
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'native_req_1',
      },
    });
  };

  const client = createDeepSeekToolCallClient({
    accessProvider: 'deepseek',
    apiKey: 'native-secret',
    baseUrl: 'https://api.deepseek.com/',
  }, { fetch: fakeFetch });

  const result = await client.callRequiredTool<{ summary: string }>({
    tier: 'pro',
    messages: [{ role: 'user', content: 'Cancel and refund order #1001.' }],
    tool,
  });

  assert.equal(body?.model, DEEPSEEK_TOOL_MODELS.deepseek.pro);
  assert.deepEqual(body?.thinking, { type: 'enabled' });
  assert.equal(body?.reasoning_effort, 'high');
  assert.equal('temperature' in (body ?? {}), false);
  assert.equal('providerOptions' in (body ?? {}), false);
  assert.deepEqual(result.value, { summary: 'cancel after verification' });
  assert.equal(result.generation.requestId, 'native_req_1');
  assert.equal(result.generation.thinking, 'high');
  assert.equal(result.generation.usage.cachedInputTokens, 300);
  assert.equal(result.generation.usage.reasoningTokens, 70);
});

test('direct DeepSeek Flash explicitly disables thinking', async () => {
  let body: Record<string, any> | undefined;
  const fakeFetch: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, any>;
    return jsonResponse({
      choices: [{
        message: {
          tool_calls: [{
            function: { name: tool.name, arguments: '{"summary":"tagged"}' },
          }],
        },
      }],
    });
  };

  const client = createDeepSeekToolCallClient({
    accessProvider: 'deepseek',
    apiKey: 'native-secret',
  }, { fetch: fakeFetch });

  await client.callRequiredTool({
    tier: 'flash',
    messages: [{ role: 'user', content: 'Tag this ticket.' }],
    tool,
  });

  assert.equal(body?.model, DEEPSEEK_TOOL_MODELS.deepseek.flash);
  assert.deepEqual(body?.thinking, { type: 'disabled' });
  assert.equal('reasoning_effort' in (body ?? {}), false);
  assert.equal(body?.temperature, 0.2);
});

test('transport failures are one attempt and never hide a retry', async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls += 1;
    return new Response('rate limited', { status: 429 });
  };
  const client = createDeepSeekToolCallClient({
    accessProvider: 'vercel-ai-gateway',
    apiKey: 'gateway-secret',
  }, { fetch: fakeFetch });

  await assert.rejects(
    client.callRequiredTool({
      tier: 'flash',
      messages: [{ role: 'user', content: 'Draft a reply.' }],
      tool,
    }),
    (error: unknown) => {
      assert.ok(error instanceof DeepSeekToolCallError);
      assert.equal(error.code, 'http_error');
      assert.equal(error.status, 429);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('timeout aborts the single in-flight request with a normalized error', async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async (_input, init) => {
    calls += 1;
    return await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };
  const client = createDeepSeekToolCallClient({
    accessProvider: 'deepseek',
    apiKey: 'native-secret',
    timeoutMs: 5,
  }, { fetch: fakeFetch });

  await assert.rejects(
    client.callRequiredTool({
      tier: 'pro',
      messages: [{ role: 'user', content: 'Resolve a policy conflict.' }],
      tool,
    }),
    (error: unknown) => {
      assert.ok(error instanceof DeepSeekToolCallError);
      assert.equal(error.code, 'timeout');
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('timeout includes a stalled response body after headers arrive', async () => {
  const fakeFetch: typeof fetch = async (_input, init) => new Response(new ReadableStream({
    start(controller) {
      init?.signal?.addEventListener('abort', () => controller.error(new Error('body aborted')), { once: true });
    },
  }), { headers: { 'Content-Type': 'application/json' } });
  const client = createDeepSeekToolCallClient({
    accessProvider: 'vercel-ai-gateway', apiKey: 'gateway-secret', timeoutMs: 10,
  }, { fetch: fakeFetch });
  await assert.rejects(client.callRequiredTool({
    tier: 'pro', messages: [{ role: 'user', content: 'Draft a plan.' }], tool,
  }), (error: unknown) => {
    assert.ok(error instanceof DeepSeekToolCallError);
    assert.equal(error.code, 'timeout');
    return true;
  });
});

test('application parsing errors remain validation failures for caller-owned escalation', async () => {
  const fakeFetch: typeof fetch = async () => jsonResponse({
    choices: [{
      message: {
        tool_calls: [{
          function: { name: tool.name, arguments: '{"summary":42}' },
        }],
      },
    }],
  });
  const client = createDeepSeekToolCallClient({
    accessProvider: 'vercel-ai-gateway',
    apiKey: 'gateway-secret',
  }, { fetch: fakeFetch });

  await assert.rejects(
    client.callRequiredTool({
      tier: 'flash',
      messages: [{ role: 'user', content: 'Draft a reply.' }],
      tool,
      parse(value) {
        const summary = (value as { summary?: unknown }).summary;
        if (typeof summary !== 'string') throw new Error('summary must be a string');
        return { summary };
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof DeepSeekToolCallError);
      assert.equal(error.code, 'invalid_tool_arguments');
      return true;
    },
  );
});
