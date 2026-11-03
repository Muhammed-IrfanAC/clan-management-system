import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { isSettled, SEASON_ROUNDS } from '@/lib/cwl/plannerInput';

/**
 * Per-war overrides (migration 046): force an account INTO or OUT OF one specific war. It applies to
 * that war only, is never carried to another round, and wins over everything the planner would
 * otherwise decide — flags included.
 *
 * POST   { seasonId, clanId, roundNumber, playerTag, mode: 'in' | 'out', reason? } — set. Returns the row.
 * DELETE { seasonId, roundNumber, playerTag }                                       — clear.
 *
 * A war that has reached battle day is locked in game, so it is refused here too: an override on it
 * could only mislead.
 */
async function roundLocked(seasonId: string, clanId: string, roundNumber: number): Promise<boolean> {
  const { data, error } = await supabase
    .from('cwl_rounds')
    .select('state')
    .eq('season_id', seasonId)
    .eq('clan_id', clanId)
    .eq('round_number', roundNumber)
    .maybeSingle();
  if (error) throw error;
  return isSettled((data as { state: string } | null)?.state);
}

const validRound = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= SEASON_ROUNDS;

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { seasonId, clanId, roundNumber, playerTag, mode, reason } = await request.json();
    if (!seasonId || !clanId || !playerTag || !validRound(roundNumber) || (mode !== 'in' && mode !== 'out')) {
      return NextResponse.json({ error: 'seasonId, clanId, roundNumber (1–7), playerTag and mode (in | out) are required' }, { status: 400 });
    }
    if (await roundLocked(seasonId, clanId, roundNumber)) {
      return NextResponse.json({ error: `War ${roundNumber} has started — its lineup is locked in game` }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('cwl_round_overrides')
      .upsert(
        {
          season_id: seasonId,
          clan_id: clanId,
          round_number: roundNumber,
          player_account_tag: playerTag,
          mode,
          reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
          created_by: auth.actorTag,
        },
        { onConflict: 'season_id,round_number,player_account_tag' },
      )
      .select('id, season_id, clan_id, round_number, player_account_tag, mode, reason, created_by, created_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, override: data });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { seasonId, roundNumber, playerTag } = await request.json();
    if (!seasonId || !playerTag || !validRound(roundNumber)) {
      return NextResponse.json({ error: 'seasonId, roundNumber (1–7) and playerTag are required' }, { status: 400 });
    }
    const { error } = await supabase
      .from('cwl_round_overrides')
      .delete()
      .eq('season_id', seasonId)
      .eq('round_number', roundNumber)
      .eq('player_account_tag', playerTag);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
  }
}
