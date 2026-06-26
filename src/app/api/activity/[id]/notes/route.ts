import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

// POST: add a progress note to a leadership log, attributed to the acting leader's player_tag.
// Any leader may add a note; only the author person may later edit/delete it.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = request.cookies.get('clanops-auth')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let actorTag: string | undefined;
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      actorTag = payload.playerTag as string | undefined;
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    if (!actorTag) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { body } = await request.json();
    const trimmed = String(body ?? '').trim();
    if (!trimmed) return NextResponse.json({ error: 'Note body is required' }, { status: 400 });

    const { data, error } = await supabase
      .from('activity_notes')
      .insert([{ log_id: id, author_tag: actorTag, body: trimmed }])
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
