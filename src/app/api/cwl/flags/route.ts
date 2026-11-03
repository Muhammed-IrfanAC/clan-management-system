import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

/**
 * Standing CWL flags on an account (migration 046): `banned` keeps it out of CWL entirely,
 * `rule_breaker` ranks its 8★ below every clean account's in the planner. A flag stays until a
 * leader removes it — there is no season scope and no expiry.
 *
 * POST   { playerTag, flag, reason? } — set (or re-word) a flag. Returns the row.
 * DELETE { playerTag, flag }          — lift it.
 *
 * A ban takes effect in the planner at once; the season's roster board only drops the account on
 * its next re-allocation, since regenerating the roster is a leader's explicit, destructive act.
 */
const FLAGS = ['banned', 'rule_breaker'] as const;
type Flag = (typeof FLAGS)[number];

function parse(body: { playerTag?: unknown; flag?: unknown }): { playerTag: string; flag: Flag } | null {
  const { playerTag, flag } = body;
  if (typeof playerTag !== 'string' || !playerTag) return null;
  if (!FLAGS.includes(flag as Flag)) return null;
  return { playerTag, flag: flag as Flag };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const parsed = parse(body);
    if (!parsed) return NextResponse.json({ error: `playerTag and flag (${FLAGS.join(' | ')}) are required` }, { status: 400 });

    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
    const { data, error } = await supabase
      .from('cwl_player_flags')
      .upsert(
        { player_account_tag: parsed.playerTag, flag: parsed.flag, reason, created_by: auth.actorTag },
        { onConflict: 'player_account_tag,flag' },
      )
      .select('player_account_tag, flag, reason, created_by, created_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, flag: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const parsed = parse(await request.json());
    if (!parsed) return NextResponse.json({ error: `playerTag and flag (${FLAGS.join(' | ')}) are required` }, { status: 400 });

    const { error } = await supabase
      .from('cwl_player_flags')
      .delete()
      .eq('player_account_tag', parsed.playerTag)
      .eq('flag', parsed.flag);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
