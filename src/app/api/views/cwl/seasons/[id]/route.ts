import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActiveView } from '@/lib/auth-server';

const TRANSFER_SELECT =
  'id, status, from_clan_id, to_clan_id, allocation:cwl_allocations!inner(season_id, player_account_tag, ' +
  'person:persons(display_name), account:player_accounts(in_game_name))';

const ALLOCATION_SELECT =
  // `note` carries the engine's reason for excluding an account — the roster board's callout reads
  // it, so it has to travel with the row rather than being re-derived in the client.
  'id, player_account_tag, person_id, recommended_clan_id, actual_clan_id, status, is_bench, note, ' +
  'person:persons(display_name), account:player_accounts(in_game_name, th_level, league, league_tier_id)';

/**
 * One CWL season's raw rows, as the CWL store maps them: season clans, allocations, transfers,
 * rounds, opt-outs, and the war members of those rounds (populated by sync). `?part=transfers`
 * returns only the transfers, which is all a roster move can change.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // The live role check runs alongside these reads (see authorizeActiveView).
    const view = await authorizeActiveView(request, async () => {
      const { id: seasonId } = await params;

      const transfersReq = supabase.from('cwl_transfers').select(TRANSFER_SELECT).eq('allocation.season_id', seasonId);
      if (request.nextUrl.searchParams.get('part') === 'transfers') {
        const { data, error } = await transfersReq;
        if (error) throw error;
        return NextResponse.json({ transfers: data || [] });
      }

      const [clansRes, allocationsRes, transfersRes, roundsRes, optoutsRes, membersRes] = await Promise.all([
        supabase.from('cwl_season_clans').select('clan_id, war_size, priority').eq('season_id', seasonId),
        supabase.from('cwl_allocations').select(ALLOCATION_SELECT).eq('season_id', seasonId),
        transfersReq,
        supabase.from('cwl_rounds').select('*').eq('season_id', seasonId),
        supabase
          .from('cwl_season_optouts')
          .select('player_account_tag, unavailable_from_round, unavailable_to_round')
          .eq('season_id', seasonId),
        // Filtered through the round's season by an inner embed (as TRANSFER_SELECT does), so it joins
        // this batch rather than waiting for the rounds to come back first.
        supabase.from('cwl_war_members').select('*, round:cwl_rounds!inner(season_id)').eq('round.season_id', seasonId),
      ]);
      const failed = [clansRes, allocationsRes, transfersRes, roundsRes, optoutsRes, membersRes].find((r) => r.error);
      if (failed?.error) throw failed.error;

      return NextResponse.json({
        clans: clansRes.data || [],
        allocations: allocationsRes.data || [],
        transfers: transfersRes.data || [],
        rounds: roundsRes.data || [],
        optouts: optoutsRes.data || [],
        warMembers: membersRes.data || [],
      });
    });
    return view.error ?? view.data;
  } catch (error) {
    console.error('API CWL Season View Error:', error);
    return NextResponse.json({ error: 'Failed to load season' }, { status: 500 });
  }
}
