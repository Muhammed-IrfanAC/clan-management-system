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
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { allocationId, action, clanId } = await request.json();
    if (!allocationId || !action) {
      return NextResponse.json({ error: 'allocationId and action are required' }, { status: 400 });
    }

    const { data: alloc, error: fetchErr } = await supabase
      .from('cwl_allocations')
      .select('id, actual_clan_id, recommended_clan_id')
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
      default:
        return NextResponse.json({ error: `Unknown action '${action}'` }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
