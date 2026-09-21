import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import {
  callAdminSupportAgentStep,
  callAdminSupportTool,
  ticketSupportModelTier,
  type SupportToolDefinition,
} from './support-model';

const ORIGINAL_ENV = {
  provider: process.env.AUTOPILOT_AI_PROVIDER,
  key: process.env.AI_GATEWAY_API_KEY,
  baseUrl: process.env.AI_GATEWAY_BASE_URL,
};
const ORIGINAL_FETCH = globalThis.fetch;

const TEST_TOOL: SupportToolDefinition = {
  name: 'return_result',
  description: 'Return a structured result.',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: ['value'],
  },
};

function restoreEnv(name: keyof typeof ORIGINAL_ENV, envName: string): void {
  const value = ORIGINAL_ENV[name];
  if (value === undefined) delete process.env[envName];
  else process.env[envName] = value;
}

afterEach(() => {
  restoreEnv('provider', 'AUTOPILOT_AI_PROVIDER');
  restoreEnv('key', 'AI_GATEWAY_API_KEY');
  restoreEnv('baseUrl', 'AI_GATEWAY_BASE_URL');
  globalThis.fetch = ORIGINAL_FETCH;
});

test('manual ticket AI uses Flash for routine work', () => {
  assert.equal(ticketSupportModelTier('Where is order #1025?', 'order_status'), 'flash');
  assert.equal(ticketSupportModelTier('Please summarize this conversation.'), 'flash');
});

test('manual ticket AI uses Pro for mutations, returns, and policy-sensitive cases', () => {
  assert.equal(ticketSupportModelTier('Please cancel and refund order #1025.'), 'pro');
  assert.equal(ticketSupportModelTier('Can I return this damaged item?'), 'pro');
  assert.equal(ticketSupportModelTier('Normal words', 'address_change'), 'pro');
  assert.equal(ticketSupportModelTier('I filed a chargeback.'), 'pro');
});

test('admin model calls fail clearly when the Gateway credential is missing', async () => {
  process.env.AUTOPILOT_AI_PROVIDER = 'auto';
  delete process.env.AI_GATEWAY_API_KEY;

  await assert.rejects(
    callAdminSupportTool({
      tier: 'flash',
      system: 'System',
      user: 'User',
      tool: TEST_TOOL,
      maxTokens: 100,
    }),
    /AI_GATEWAY_API_KEY is required.*legacy model fallback is disabled/i,
  );
});

test('legacy provider selectors are rejected instead of invoking Claude', async () => {
  process.env.AUTOPILOT_AI_PROVIDER = ['anthropic', 'legacy'].join('-');
  process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    throw new Error('fetch should not run');
  };

  await assert.rejects(
    callAdminSupportTool({
      tier: 'flash',
      system: 'System',
      user: 'User',
      tool: TEST_TOOL,
      maxTokens: 100,
    }),
    /only supports DeepSeek V4 through Vercel AI Gateway/i,
  );
  assert.equal(fetched, false);
});

test('Gateway failures surface directly and never trigger a second-provider fallback', async () => {
  process.env.AUTOPILOT_AI_PROVIDER = 'vercel-ai-gateway';
  process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response('provider unavailable', { status: 503 });
  };

  await assert.rejects(
    callAdminSupportTool({
      tier: 'pro',
      system: 'System',
      user: 'User',
      tool: TEST_TOOL,
      maxTokens: 100,
    }),
    /DeepSeek V4 through Vercel AI Gateway returned HTTP 503/,
  );
  assert.equal(fetchCount, 1);
});

test('Flash requests use only DeepSeek V4 Flash through Gateway with thinking disabled', async () => {
  process.env.AUTOPILOT_AI_PROVIDER = 'auto';
  process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
  process.env.AI_GATEWAY_BASE_URL = 'https://gateway.example/v1/';
  let requestUrl = '';
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: 'response-flash',
      model: 'deepseek/deepseek-v4.1-flash',
      provider: 'deepinfra',
      choices: [{
        message: {
          tool_calls: [{
            id: 'call-flash',
            type: 'function',
            function: { name: TEST_TOOL.name, arguments: '{"value":"ok"}' },
          }],
        },
      }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    }), {
      status: 200,
      headers: { 'x-vercel-ai-gateway-request-id': 'gateway-flash' },
    });
  };

  const result = await callAdminSupportTool<{ value: string }>({
    tier: 'flash',
    system: 'System',
    user: 'User',
    tool: TEST_TOOL,
    maxTokens: 100,
  });

  assert.equal(requestUrl, 'https://gateway.example/v1/chat/completions');
  assert.equal(requestBody.model, 'deepseek/deepseek-v4.1-flash');
  assert.deepEqual(requestBody.reasoning, { effort: 'none', exclude: true });
  assert.equal(JSON.stringify(requestBody).toLowerCase().includes('claude'), false);
  assert.equal(JSON.stringify(requestBody).toLowerCase().includes('anthropic'), false);
  assert.equal(result.value.value, 'ok');
  assert.equal(result.generation.access_provider, 'vercel-ai-gateway');
  assert.equal(result.generation.thinking, 'disabled');
});

test('agent steps use DeepSeek V4 Pro through Gateway and preserve tool-call messages', async () => {
  process.env.AUTOPILOT_AI_PROVIDER = 'vercel-ai-gateway';
  process.env.AI_GATEWAY_API_KEY = 'test-gateway-key';
  let requestBody: Record<string, unknown> = {};
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      id: 'response-pro',
      model: 'deepseek/deepseek-v4-pro',
      provider: 'deepseek',
      choices: [{
        message: {
          content: 'I will update that.',
          tool_calls: [{
            id: 'call-pro',
            type: 'function',
            function: { name: TEST_TOOL.name, arguments: '{"value":"changed"}' },
          }],
        },
      }],
      usage: {
        prompt_tokens: 20,
        completion_tokens: 8,
        completion_tokens_details: { reasoning_tokens: 3 },
      },
    }), { status: 200 });
  };

  const result = await callAdminSupportAgentStep({
    tier: 'pro',
    system: 'System',
    messages: [{ role: 'user', content: 'Make a change.' }],
    tools: [TEST_TOOL],
    maxTokens: 100,
  });

  assert.equal(requestBody.model, 'deepseek/deepseek-v4-pro');
  assert.deepEqual(requestBody.reasoning, { effort: 'high', exclude: true });
  assert.equal(requestBody.tool_choice, 'auto');
  assert.equal(JSON.stringify(requestBody).toLowerCase().includes('claude'), false);
  assert.deepEqual(result.toolCalls, [{
    id: 'call-pro',
    name: TEST_TOOL.name,
    input: { value: 'changed' },
  }]);
  assert.equal(result.assistantMessage.tool_calls?.[0]?.function.name, TEST_TOOL.name);
  assert.equal(result.generation.thinking, 'high');
});
