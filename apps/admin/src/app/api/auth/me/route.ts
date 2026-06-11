import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';

/** Current session identity — used by the UI for "Assign to me" and "Mine" views. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    userId: session.userId ?? null,
    name: session.name ?? null,
    role: session.role,
    brandSlug: session.brandSlug,
  });
}
