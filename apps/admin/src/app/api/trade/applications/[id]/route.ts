import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const { data: application, error } = await supabase
    .from('trade_applications')
    .select('*')
    .eq('id', id)
    .eq('brand_id', session.brandId)
    .single();

  if (error || !application) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }

  const { data: activityLog } = await supabase
    .from('trade_activity_log')
    .select('*')
    .eq('entity_id', id)
    .eq('entity_type', 'application')
    .order('created_at', { ascending: false });

  return NextResponse.json({
    application,
    activityLog: activityLog ?? [],
  });
}
