import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hasCapability, authorizeActive as authorize } from '@/lib/auth-server';

// Resolve a player_tag to the person (persona) it is linked to, if any.
async function personIdForTag(tag: string): Promise<string | null> {
  const { data } = await supabase
    .from('player_accounts')
    .select('person_id')
    .eq('player_tag', tag)
    .maybeSingle();
  return data?.person_id ?? null;
}

// Load a note and enforce the modification rule shared by edit + delete: only the note's
// AUTHOR PERSON may change it. Authorship is resolved at the person level, not the account
// level, so any alt belonging to the same person as the original author can edit/delete it
// too. Notes are editable for the lifetime of the member (no baby gate).
async function guardEditable(noteId: string, actorTag: string) {
  const { data: note } = await supabase
    .from('member_notes')
    .select('id, person_id, author_tag')
    .eq('id', noteId)
    .maybeSingle();
  if (!note) return { error: NextResponse.json({ error: 'Note not found' }, { status: 404 }) };

  // Fast path: same account. Otherwise allow when both tags resolve to the same person (alts).
  if (note.author_tag !== actorTag) {
    const [authorPerson, actorPerson] = await Promise.all([
      personIdForTag(note.author_tag),
      personIdForTag(actorTag),
    ]);
    if ((!authorPerson || !actorPerson || authorPerson !== actorPerson) && !(await hasCapability(actorTag, 'content.override'))) {
      return { error: NextResponse.json({ error: 'Only the note author can modify this note' }, { status: 403 }) };
    }
  }
  return { note };
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
    if (!trimmed) return NextResponse.json({ error: 'Note body is required' }, { status: 400 });

    const { data, error } = await supabase
      .from('member_notes')
      .update({ body: trimmed, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API Member Note Error:', error);
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

    const { error } = await supabase.from('member_notes').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API Member Note Error:', error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
