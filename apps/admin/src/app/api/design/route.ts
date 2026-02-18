import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('ai_config')
    .select('value')
    .eq('brand_id', session.brandId)
    .eq('key', 'widget_design')
    .single();

  if (error && error.code !== 'PGRST116') {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let design = null;
  if (data?.value) {
    try {
      design = JSON.parse(data.value);
    } catch {
      // ignore parse error
    }
  }

  return NextResponse.json({ design });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const {
    primaryColor,
    backgroundColor,
    headerTitle,
    position,
    bubbleIcon,
    welcomeMessage,
    inputPlaceholder,
    borderRadius,
    fontSize,
    showBrandingBadge,
    autoOpenDelay,
  } = body;

  const design = {
    primaryColor,
    backgroundColor,
    headerTitle,
    position,
    bubbleIcon,
    welcomeMessage,
    inputPlaceholder,
    borderRadius,
    fontSize,
    showBrandingBadge,
    autoOpenDelay,
  };

  const { error } = await supabase
    .from('ai_config')
    .upsert(
      {
        brand_id: session.brandId,
        key: 'widget_design',
        value: JSON.stringify(design),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,key' }
    );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
