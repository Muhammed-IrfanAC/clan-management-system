import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { resolveTagNames } from '@/lib/tagNames';

/**
 * Everything the Member Dossier loads for one person, in one response: the person with accounts,
 * strikes, activity and notes; which of their accounts are on the kick list; and the name lookup for
 * strike loggers and note authors. The last two both key off the person, so they run in parallel.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;
    const { id } = await params;

    const { data: person, error } = await supabase
      .from('persons')
      .select(`
        *,
        player_accounts (
          *,
          clan:clans (*)
        ),
        strikes (
          *,
          rule:rules (*),
          strike_violations (*)
        ),
        activity_logs:leadership_logs (*),
        member_notes (*)
      `)
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 });

    type PersonRow = {
      player_accounts: { player_tag: string }[] | null;
      strikes: { logged_by: string | null }[] | null;
      member_notes: { author_tag: string | null }[] | null;
    };
    const p = person as unknown as PersonRow;
    const accountTags = (p.player_accounts || []).map((a) => a.player_tag);

    const [kickedRes, names] = await Promise.all([
      accountTags.length
        ? supabase.from('kicked_accounts').select('player_tag').in('player_tag', accountTags)
        : Promise.resolve({ data: [] as { player_tag: string }[], error: null }),
      resolveTagNames([...(p.strikes || []).map((s) => s.logged_by), ...(p.member_notes || []).map((c) => c.author_tag)]),
    ]);
    if (kickedRes.error) console.error('Kick list lookup failed:', kickedRes.error);

    return NextResponse.json({
      person,
      kickedTags: ((kickedRes.data as { player_tag: string }[] | null) || []).map((k) => k.player_tag),
      ...names,
    });
  } catch (error) {
    console.error('API Member Dossier View Error:', error);
    return NextResponse.json({ error: 'Failed to load member' }, { status: 500 });
  }
}
