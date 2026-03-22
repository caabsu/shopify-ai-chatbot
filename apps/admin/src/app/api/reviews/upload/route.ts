import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getSupabase } from '@/lib/supabase';

const BUCKET = 'review-media';

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const contentType = req.headers.get('content-type') || 'image/jpeg';
    const body = await req.arrayBuffer();

    if (!body || body.byteLength === 0) {
      return NextResponse.json({ error: 'No file data received' }, { status: 400 });
    }

    // Determine file extension from content type
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
    };
    const ext = extMap[contentType] || 'jpg';
    const fileName = `${session.brandId}/${crypto.randomUUID()}.${ext}`;

    const client = getSupabase();
    const { error: uploadError } = await client.storage
      .from(BUCKET)
      .upload(fileName, Buffer.from(body), {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = client.storage
      .from(BUCKET)
      .getPublicUrl(fileName);

    return NextResponse.json({
      storage_path: fileName,
      url: urlData.publicUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
