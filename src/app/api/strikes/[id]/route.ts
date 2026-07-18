import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hasCapability, authorizeActive as authorize } from '@/lib/auth-server';
import { buildStrikeStatusUpdate, type StrikeStatusPatch } from '@/lib/strikes/mutations';

// Resolve a player_tag to the person it is linked to, if any.
async function personIdForTag(tag: string): Promise<string | null> {
  const { data } = await supabase
    .from('player_accounts')
    .select('person_id')
    .eq('player_tag', tag)
    .maybeSingle();
  return data?.person_id ?? null;
}

// Authorship at the PERSON level: the strike's logger and the actor are each mapped to their
// person, and editing is allowed when they match — so any alt of the original author can edit too.
async function isAuthor(loggedBy: string, actorTag: string): Promise<boolean> {
  if (loggedBy === actorTag) return true;
  const [authorPerson, actorPerson] = await Promise.all([
    personIdForTag(loggedBy),
    personIdForTag(actorTag),
  ]);
  return !!authorPerson && !!actorPerson && authorPerson === actorPerson;
}

/** GET one strike with everything the Player Dossier needs. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    const { data, error } = await supabase
      .from('strikes')
      .select(`
        *,
        person:persons (*),
        rule:rules (*),
        player_account:player_accounts (*),
        strike_violations (*),
        strike_notes (*)
      `)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Strike not found' }, { status: 404 });
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH a strike's leader-driven status: trust-restoration checklist, leadership approval, and
 * third-strike removal bookkeeping — all open to any leader (like the old acknowledge toggle), since
 * they are status actions, not content edits. NONE of them change the active count (only the 90-day
 * expiry does); approval merely clears the demotion/war-eligibility intent. The `notes` free-text
 * field, being authored content, is author-or-override-only.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    const body = (await request.json()) as StrikeStatusPatch;

    const { data: existing } = await supabase
      .from('strikes')
      .select('logged_by')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Strike not found' }, { status: 404 });

    // Editing the strike's own notes is authored content — gate it author-or-override.
    if (body.notes !== undefined) {
      if (!(await isAuthor(existing.logged_by, auth.actorTag!)) && !(await hasCapability(auth.actorTag!, 'content.override'))) {
        return NextResponse.json({ error: 'Only the strike author can edit its notes' }, { status: 403 });
      }
    }

    const built = buildStrikeStatusUpdate(body, auth.actorTag!, new Date().toISOString());
    if (built.error || !built.updates) {
      return NextResponse.json({ error: built.error ?? 'No update' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('strikes')
      .update(built.updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/** DELETE a strike (cascades to its violations/notes). Author-only unless the actor can override. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    const { data: existing } = await supabase
      .from('strikes')
      .select('logged_by')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Strike not found' }, { status: 404 });
    if (!(await isAuthor(existing.logged_by, auth.actorTag!)) && !(await hasCapability(auth.actorTag!, 'content.override'))) {
      return NextResponse.json({ error: 'Only the strike author can delete it' }, { status: 403 });
    }

    const { error } = await supabase.from('strikes').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
