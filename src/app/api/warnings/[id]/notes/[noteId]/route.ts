import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { canModifyAuthored, authorizeActive as authorize, type ActiveAuth } from '@/lib/auth-server';

// Only the note's AUTHOR PERSON may modify it. Authorship is resolved at the person level,
// so any alt belonging to the same person as the original author can edit/delete it too.
async function guardEditable(noteId: string, auth: ActiveAuth) {
  const { data: note } = await supabase
    .from('warning_notes')
    .select('id, author_tag')
    .eq('id', noteId)
    .maybeSingle();
  if (!note) return { error: NextResponse.json({ error: 'Note not found' }, { status: 404 }) };

  if (!(await canModifyAuthored(auth, note.author_tag))) {
    return { error: NextResponse.json({ error: 'Only the note author can modify this note' }, { status: 403 }) };
  }
  return { note };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { noteId } = await params;
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    const guard = await guardEditable(noteId, auth);
    if (guard.error) return guard.error;

    const { body } = await request.json();
    const trimmed = String(body ?? '').trim();
    if (!trimmed) return NextResponse.json({ error: 'Note body is required' }, { status: 400 });

    const { data, error } = await supabase
      .from('warning_notes')
      .update({ body: trimmed, updated_at: new Date().toISOString() })
      .eq('id', noteId)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> }
) {
  try {
    const { noteId } = await params;
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    const guard = await guardEditable(noteId, auth);
    if (guard.error) return guard.error;

    const { error } = await supabase.from('warning_notes').delete().eq('id', noteId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
