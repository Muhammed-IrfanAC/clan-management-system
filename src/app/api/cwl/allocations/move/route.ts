import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { resyncTransfer } from '@/lib/cwl/roster';

/**
 * Apply a leader's manual edit to one allocation and keep its transfer record consistent.
 *
 * Body: { allocationId, action, clanId? }
 *  - assign  (clanId): move the player to that clan's fighting roster; status re-derived vs their
 *    actual clan (matches | transfer_required) and the pending transfer resynced.
 *  - bench / unbench:   toggle the player between bench and fighting roster within their clan.
 *  - remove:            pull the player from the season (status 'removed', pending transfer cleared).
 *  - opt_out / opt_in:  mark the ACCOUNT as not participating this season, and undo that. Missing
 *    a single war is not an opt-out: it is a per-war override on the planner (migration 046).
 *
 * opt_out is 'remove' plus a durable record. 'remove' only writes status onto the allocation row,
 * and every allocation row is deleted and rebuilt by a re-allocation — so a leader who sat someone
 * out found them back on the board the next time the clan order changed. opt_out additionally writes
 * cwl_season_optouts (migration 031), which is an INPUT to the engine, so the decision is re-applied
 * on every regeneration instead of being overwritten by one.
 *
 * Returns the updated allocation row so the client can splice just that card into place instead of
 * refetching (and re-rendering) the whole board.
 */
const ALLOCATION_FIELDS = 'id, player_account_tag, person_id, recommended_clan_id, actual_clan_id, status, is_bench, rank, note';
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { allocationId, action, clanId, reason } = await request.json();
    if (!allocationId || !action) {
      return NextResponse.json({ error: 'allocationId and action are required' }, { status: 400 });
    }

    const { data: alloc, error: fetchErr } = await supabase
      .from('cwl_allocations')
      .select('id, actual_clan_id, recommended_clan_id, season_id, player_account_tag')
      .eq('id', allocationId)
      .single();
    if (fetchErr) throw fetchErr;

    switch (action) {
      case 'assign': {
        if (!clanId) return NextResponse.json({ error: 'clanId is required to assign' }, { status: 400 });
        const status = clanId === alloc.actual_clan_id ? 'matches' : 'transfer_required';
        const { error } = await supabase
          .from('cwl_allocations')
          .update({ recommended_clan_id: clanId, is_bench: false, status })
          .eq('id', allocationId);
        if (error) throw error;
        await resyncTransfer(allocationId, alloc.actual_clan_id, clanId);
        break;
      }
      case 'bench':
      case 'unbench': {
        if (action === 'bench' && !alloc.recommended_clan_id) {
          return NextResponse.json({ error: 'Assign the player to a clan before benching' }, { status: 400 });
        }
        const { error } = await supabase
          .from('cwl_allocations')
          .update({ is_bench: action === 'bench' })
          .eq('id', allocationId);
        if (error) throw error;
        break;
      }
      case 'remove': {
        const { error } = await supabase
          .from('cwl_allocations')
          .update({ recommended_clan_id: null, is_bench: false, status: 'removed', rank: null })
          .eq('id', allocationId);
        if (error) throw error;
        await resyncTransfer(allocationId, alloc.actual_clan_id, null);
        break;
      }
      case 'opt_out': {
        // Record the decision first — if the allocation update fails the account is still marked,
        // which is the safe direction: over-excluding is visible on the board, under-excluding puts
        // someone in a war they said they could not play.
        const { error: optErr } = await supabase
          .from('cwl_season_optouts')
          .upsert(
            {
              season_id: alloc.season_id,
              player_account_tag: alloc.player_account_tag,
              reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
              created_by: auth.actorTag,
            },
            { onConflict: 'season_id,player_account_tag' },
          );
        if (optErr) throw optErr;
        const { error } = await supabase
          .from('cwl_allocations')
          .update({
            recommended_clan_id: null,
            is_bench: false,
            status: 'removed',
            rank: null,
            note: 'Not participating this season (marked by leadership)',
          })
          .eq('id', allocationId);
        if (error) throw error;
        await resyncTransfer(allocationId, alloc.actual_clan_id, null);
        break;
      }
      case 'opt_in': {
        // Clears the flag only. The account is back in the pool for the next re-allocation, but it
        // is NOT auto-placed: dropping a body straight back into a clan would push it over its war
        // size with no leader deciding who that displaces. Assigning it is a separate, explicit act.
        const { error: optErr } = await supabase
          .from('cwl_season_optouts')
          .delete()
          .eq('season_id', alloc.season_id)
          .eq('player_account_tag', alloc.player_account_tag);
        if (optErr) throw optErr;
        const { error } = await supabase
          .from('cwl_allocations')
          .update({ note: null })
          .eq('id', allocationId);
        if (error) throw error;
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
    }

    const { data: updated, error: readErr } = await supabase
      .from('cwl_allocations')
      .select(ALLOCATION_FIELDS)
      .eq('id', allocationId)
      .single();
    if (readErr) throw readErr;

    return NextResponse.json({ success: true, allocation: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
