const apiKey = process.env.AI_GATEWAY_API_KEY?.trim();
const baseUrl = (process.env.AI_GATEWAY_BASE_URL?.trim() || 'https://ai-gateway.vercel.sh/v1')
  .replace(/\/+$/, '');

if (!apiKey) {
  throw new Error('AI_GATEWAY_API_KEY is required');
}

const models = [
  process.env.AUTOPILOT_FLASH_MODEL?.trim() || 'deepseek/deepseek-v4.1-flash',
  process.env.AUTOPILOT_PRO_MODEL?.trim() || 'deepseek/deepseek-v4-pro',
];

for (const model of models) {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
        max_tokens: 8,
      }),
    });
    const body = (await response.text()).slice(0, 500);
    console.log(JSON.stringify({ model, status: response.status, body }));
  } catch (error) {
    console.log(JSON.stringify({
      model,
      status: 0,
      body: error instanceof Error ? error.message : String(error),
    }));
  }
}
