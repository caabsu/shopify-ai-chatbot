import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const result = await supabase.from('support_automation_settings').select('*').eq('brand_id', session.brandId).maybeSingle();
  return NextResponse.json({ settings: result.data, ready: !result.error && Boolean(result.data), worker_configured: Boolean(process.env.SUPPORT_AUTOMATION_SECRET), model: process.env.AUTOPILOT_FLASH_MODEL || 'deepseek/deepseek-v4.1-flash', reasoning_model: process.env.AUTOPILOT_PRO_MODEL || 'deepseek/deepseek-v4-pro', gateway_configured: Boolean(process.env.AI_GATEWAY_API_KEY) });
}
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid settings.' }, { status: 400 }); }
  if (typeof body.enabled !== 'boolean' || typeof body.allow_cancellation !== 'boolean' || typeof body.allow_retention_refund !== 'boolean'
    || typeof body.min_confidence !== 'number' || !Number.isFinite(body.min_confidence) || body.min_confidence < 0.8 || body.min_confidence > 1
    || typeof body.mutation_min_confidence !== 'number' || !Number.isFinite(body.mutation_min_confidence) || body.mutation_min_confidence < 0.9 || body.mutation_min_confidence > 1
    || body.mutation_min_confidence < body.min_confidence) return NextResponse.json({ error: 'Reply confidence must be 80–100%; order changes must be 90–100% and at least the reply threshold.' }, { status: 400 });
  const result = await supabase.from('support_automation_settings').update({ enabled: body.enabled, min_confidence: body.min_confidence, mutation_min_confidence: body.mutation_min_confidence, allow_cancellation: body.allow_cancellation, allow_retention_refund: body.allow_retention_refund, updated_at: new Date().toISOString() }).eq('brand_id', session.brandId).select('*').single();
  if (result.error) return NextResponse.json({ error: 'Could not save automation rules. Apply the automation migration first.' }, { status: 503 });
  return NextResponse.json({ settings: result.data });
}
