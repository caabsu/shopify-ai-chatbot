import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSupportModelAccess } from './support-model-tool.service.js';

test('auto provider prefers Gateway, then native DeepSeek, and otherwise fails closed', () => {
  assert.equal(resolveSupportModelAccess({
    configuredProvider: 'auto',
    gatewayApiKey: 'gateway',
    nativeApiKey: 'native',
  }), 'vercel-ai-gateway');
  assert.equal(resolveSupportModelAccess({
    configuredProvider: 'auto',
    gatewayApiKey: '',
    nativeApiKey: 'native',
  }), 'deepseek');
  assert.throws(() => resolveSupportModelAccess({
    configuredProvider: 'auto',
    gatewayApiKey: '',
    nativeApiKey: '',
  }), /cross-provider fallback is disabled/);
});

test('explicit provider fails fast when its credential is absent', () => {
  assert.throws(() => resolveSupportModelAccess({
    configuredProvider: 'vercel-ai-gateway',
    gatewayApiKey: '',
    nativeApiKey: 'native',
  }), /AI_GATEWAY_API_KEY/);
  assert.throws(() => resolveSupportModelAccess({
    configuredProvider: 'deepseek',
    gatewayApiKey: 'gateway',
    nativeApiKey: '',
  }), /DEEPSEEK_API_KEY/);
  assert.throws(() => resolveSupportModelAccess({
    configuredProvider: 'anthropic',
    gatewayApiKey: 'gateway',
    nativeApiKey: 'native',
  }), /Unsupported AUTOPILOT_AI_PROVIDER/);
});
