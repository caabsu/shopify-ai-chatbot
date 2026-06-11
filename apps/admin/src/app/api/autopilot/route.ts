import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * Autopilot review queue. Lists tickets carrying an AI action plan
 * (tickets.metadata.autopilot), grouped by review state:
 *   pending   → status proposed (needs a human decision)
 *   done      → executed / partially_executed / failed
 *   dismissed → dismissed
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tab = req.nextUrl.searchParams.get('tab') || 'pending';
  const statuses =
    tab === 'done' ? ['executed', 'partially_executed', 'failed', 'approved', 'executing']
    : tab === 'dismissed' ? ['dismissed']
    : ['proposed'];

  const { data, error } = await supabase
    .from('tickets')
    .select('*')
    .eq('brand_id', session.brandId)
    .filter('metadata->autopilot->>status', 'in', `(${statuses.join(',')})`)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Counts for the tab bar
  const [pendingRes, doneRes, dismissedRes] = await Promise.all([
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', session.brandId).filter('metadata->autopilot->>status', 'eq', 'proposed'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', session.brandId).filter('metadata->autopilot->>status', 'in', '(executed,partially_executed,failed)'),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('brand_id', session.brandId).filter('metadata->autopilot->>status', 'eq', 'dismissed'),
  ]);

  return NextResponse.json({
    tickets: data ?? [],
    counts: {
      pending: pendingRes.count ?? 0,
      done: doneRes.count ?? 0,
      dismissed: dismissedRes.count ?? 0,
    },
  });
}
