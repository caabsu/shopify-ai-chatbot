import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const [convResult, msgResult] = await Promise.all([
    supabase
      .from('conversations')
      .select('*')
      .eq('id', id)
      .eq('brand_id', session.brandId)
      .single(),
    supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true }),
  ]);

  if (convResult.error) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  return NextResponse.json({
    conversation: convResult.data,
    messages: msgResult.data ?? [],
  });
}
