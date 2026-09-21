import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const key = process.env.AI_GATEWAY_API_KEY;
  if (!key) return NextResponse.json({ configured: false, available: false });
  try {
    const base = (process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh/v1').replace(/\/+$/, '');
    const response = await fetch(`${base}/credits`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!response.ok) return NextResponse.json({ configured: true, available: false, status: response.status });
    const data = await response.json();
    const balance = Number(data.balance);
    const totalUsed = Number(data.total_used);
    return NextResponse.json({ configured: true, available: true, balance: Number.isFinite(balance) ? balance : null, total_used: Number.isFinite(totalUsed) ? totalUsed : null, checked_at: new Date().toISOString() });
  } catch { return NextResponse.json({ configured: true, available: false }); }
}
