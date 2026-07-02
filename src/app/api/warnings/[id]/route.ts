import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hasCapability, authorizeActive as authorize } from '@/lib/auth-server';

// Resolve a player_tag to the persona it is linked to, if any.
async function personIdForTag(tag: string): Promise<string | null> {
  const { data } = await supabase
    .from('player_accounts')
    .select('person_id')
    .eq('player_tag', tag)
    .maybeSingle();
  return data?.person_id ?? null;
}

// Authorship is resolved at the PERSON level, not the account level: the warning's logger
// (warnings.logged_by) and the actor are each mapped to their persona, and editing is
// allowed when they match — so any alt of the original author can edit too.
async function isAuthor(loggedBy: string, actorTag: string): Promise<boolean> {
  if (loggedBy === actorTag) return true;
  const [authorPerson, actorPerson] = await Promise.all([
    personIdForTag(loggedBy),
    personIdForTag(actorTag),
  ]);
  return !!authorPerson && !!actorPerson && authorPerson === actorPerson;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    const body = await request.json();

    // Acknowledge toggle is a lightweight status action open to any leader.
    if ('acknowledged' in body && Object.keys(body).length === 1) {
      const { data, error } = await supabase
        .from('warnings')
        .update({
          acknowledged: body.acknowledged,
          acknowledged_at: body.acknowledged ? new Date().toISOString() : null,
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json(data);
    }

    // Otherwise this is a content edit (rule / date / description) — author-only.
    const { data: existing } = await supabase
      .from('warnings')
      .select('logged_by')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Warning not found' }, { status: 404 });

    // Author-only, unless the actor holds the override capability (leaders / super admin).
    if (!(await isAuthor(existing.logged_by, auth.actorTag!)) && !(await hasCapability(auth.actorTag!, 'content.override'))) {
      return NextResponse.json({ error: 'Only the warning author can edit it' }, { status: 403 });
    }

    const { ruleId, description, loggedAt } = body;
    const updates: Record<string, any> = { edited_at: new Date().toISOString() };

    if (description !== undefined) {
      const trimmed = String(description ?? '').trim();
      if (!trimmed) return NextResponse.json({ error: 'Description is required' }, { status: 400 });
      updates.description = trimmed;
    }

    if (ruleId !== undefined) {
      updates.rule_id = ruleId || null;
    }

    if (loggedAt !== undefined) {
      const parsed = new Date(loggedAt);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid date provided' }, { status: 400 });
      }
      if (parsed.getTime() > Date.now()) {
        return NextResponse.json({ error: 'Warning date cannot be in the future' }, { status: 400 });
      }
      updates.logged_at = parsed.toISOString();
    }

    const { data, error } = await supabase
      .from('warnings')
      .update(updates)
      .eq('id', id)
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    // Deleting a warning is a modification — author-only, unless the actor can override.
    const { data: existing } = await supabase
      .from('warnings')
      .select('logged_by')
      .eq('id', id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: 'Warning not found' }, { status: 404 });
    if (!(await isAuthor(existing.logged_by, auth.actorTag!)) && !(await hasCapability(auth.actorTag!, 'content.override'))) {
      return NextResponse.json({ error: 'Only the warning author can delete it' }, { status: 403 });
    }

    const { error } = await supabase.from('warnings').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
