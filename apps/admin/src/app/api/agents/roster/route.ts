import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * Slim agent roster for assignment dropdowns. Unlike GET /api/agents (admin
 * only, full records), this is available to every signed-in agent and exposes
 * only what the assignment UI needs — no emails, no hashes.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('agent_users')
    .select('id, name, role, agent_id')
    .eq('brand_id', session.brandId)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to load roster' }, { status: 500 });
  }

  return NextResponse.json({ agents: data ?? [] });
}
