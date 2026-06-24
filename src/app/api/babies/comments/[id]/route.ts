import { NextResponse, NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { supabase } from '@/lib/supabase';
import { isPersonBaby } from '@/lib/babies';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

async function authorize(request: NextRequest) {
  const token = request.cookies.get('clanops-auth')?.value;
  if (!token) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const actorTag = payload.playerTag as string | undefined;
    if (!actorTag) return { error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) };
    return { actorTag };
  } catch {
    return { error: NextResponse.json({ error: 'Invalid token' }, { status: 401 }) };
  }
}

// Resolve a player_tag to the person (persona) it is linked to, if any.
async function personIdForTag(tag: string): Promise<string | null> {
  const { data } = await supabase
    .from('player_accounts')
    .select('person_id')
    .eq('player_tag', tag)
    .maybeSingle();
  return data?.person_id ?? null;
}

// Load a comment and enforce the two modification rules shared by edit + delete:
// (1) the persona must still be in its baby trial; (2) only the comment's AUTHOR PERSON may
// change it. Authorship is resolved at the person level, not the account level, so any alt
// belonging to the same person as the original author can edit/delete it too.
async function guardEditable(commentId: string, actorTag: string) {
  const { data: comment } = await supabase
    .from('baby_comments')
    .select('id, person_id, author_tag')
    .eq('id', commentId)
    .maybeSingle();
  if (!comment) return { error: NextResponse.json({ error: 'Comment not found' }, { status: 404 }) };
  if (!(await isPersonBaby(comment.person_id))) {
    return { error: NextResponse.json({ error: 'The baby trial has ended; comments are now read-only' }, { status: 403 }) };
  }

  // Fast path: same account. Otherwise allow when both tags resolve to the same person (alts).
  if (comment.author_tag !== actorTag) {
    const [authorPerson, actorPerson] = await Promise.all([
      personIdForTag(comment.author_tag),
      personIdForTag(actorTag),
    ]);
    if (!authorPerson || !actorPerson || authorPerson !== actorPerson) {
      return { error: NextResponse.json({ error: 'Only the comment author can modify this comment' }, { status: 403 }) };
    }
  }
  return { comment };
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    const guard = await guardEditable(id, auth.actorTag!);
    if (guard.error) return guard.error;

    const { body } = await request.json();
    const trimmed = String(body ?? '').trim();
    if (!trimmed) return NextResponse.json({ error: 'Comment body is required' }, { status: 400 });

    const { data, error } = await supabase
      .from('baby_comments')
      .update({ body: trimmed, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API Baby Comment Error:', error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    const guard = await guardEditable(id, auth.actorTag!);
    if (guard.error) return guard.error;

    const { error } = await supabase.from('baby_comments').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API Baby Comment Error:', error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
