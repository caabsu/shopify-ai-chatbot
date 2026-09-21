import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runSupportAutomation } from '@/lib/support-automation';

export const runtime = 'nodejs';
export const maxDuration = 300;
export async function POST(req: NextRequest) {
  const secret = process.env.SUPPORT_AUTOMATION_SECRET?.trim();
  const provided = req.headers.get('authorization') || '';
  const expected = `Bearer ${secret || ''}`;
  if (!secret || secret.length < 32 || Buffer.byteLength(provided) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try { return NextResponse.json(await runSupportAutomation()); }
  catch (error) { console.error('[support-automation] Worker failed:', error instanceof Error ? error.message : 'unknown'); return NextResponse.json({ error: 'Support automation could not complete this tick.' }, { status: 503 }); }
}
