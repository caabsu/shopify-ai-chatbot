import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { executeAutopilotRequest } from '@/lib/autopilot-executor';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return executeAutopilotRequest(req, context, session);
}
