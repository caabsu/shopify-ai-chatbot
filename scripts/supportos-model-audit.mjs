import { readFileSync, existsSync } from 'node:fs';
import dotenv from 'dotenv';

// Print only availability, model metadata, balances and aggregate usage. Never keys.
for (const path of ['apps/admin/.env.local', 'apps/admin/.vercel/.env.production.local', 'apps/backend/.env']) {
  if (existsSync(path)) {
    const values = dotenv.parse(readFileSync(path));
    for (const [key, value] of Object.entries(values)) if (!process.env[key]) process.env[key] = value;
  }
}
const base = (process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh/v1').replace(/\/+$/, '');
const key = process.env.AI_GATEWAY_API_KEY;
console.log(JSON.stringify({ gatewayKeyAvailable: Boolean(key), nativeKeyAvailable: Boolean(process.env.DEEPSEEK_API_KEY) }));
const response = await fetch(`${base}/models`, { signal: AbortSignal.timeout(15000) });
const models = await response.json();
console.log(JSON.stringify({ modelsStatus: response.status, models: (models.data || []).filter(m => /deepseek.*v4/.test(m.id)).map(m => ({ id: m.id, pricing: m.pricing, context_window: m.context_window })) }));
if (key) {
  const credits = await fetch(`${base}/credits`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  console.log(JSON.stringify({ creditsStatus: credits.status, credits: credits.ok ? await credits.json() : 'Unavailable' }));
  const probe = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek/deepseek-v4.1-flash', messages: [{ role: 'user', content: 'Reply OK.' }], max_tokens: 16, reasoning: { effort: 'none', exclude: true } }),
    signal: AbortSignal.timeout(60000),
  });
  const data = await probe.json();
  console.log(JSON.stringify({ probeStatus: probe.status, model: data.model, usage: data.usage, success: Boolean(data.choices?.[0]?.message?.content), errorCode: data.error?.code }));
}
