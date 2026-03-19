import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { cookies } from 'next/headers';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data: member, error } = await supabase
    .from('trade_members')
    .select('*')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (error || !member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  const { data: activityLog } = await supabase
    .from('trade_activity_log')
    .select('*')
    .eq('entity_id', id)
    .eq('entity_type', 'member')
    .order('created_at', { ascending: false });

  return NextResponse.json({
    member,
    activityLog: activityLog ?? [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;

  const BACKEND_URL =
    process.env.BACKEND_URL || 'https://shopify-ai-chatbot-production-9ab4.up.railway.app';

  const res = await fetch(`${BACKEND_URL}/api/trade/members/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({ error: 'Invalid response from backend' }));
  return NextResponse.json(data, { status: res.status });
}
