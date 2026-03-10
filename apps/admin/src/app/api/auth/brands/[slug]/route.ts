import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const { data: brand, error } = await supabase
    .from('brands')
    .select('id, name, slug, settings')
    .eq('slug', slug)
    .eq('enabled', true)
    .single();

  if (error || !brand) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  const storefront = (brand.settings as Record<string, unknown>)?.storefront as Record<string, unknown> | undefined;

  return NextResponse.json({
    name: brand.name,
    slug: brand.slug,
    design: {
      accentColor: storefront?.accentColor || '#000000',
      bgColor: storefront?.bgGradientFrom || '#f5f0eb',
      bgGradientTo: storefront?.bgGradientTo || '#ede4db',
      headingFont: storefront?.headingFont || '',
      bodyFont: storefront?.bodyFont || '',
      fontLink: storefront?.fontLink || '',
    },
  });
}
