import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { allocate, type PoolClan } from '@/lib/cwl/allocation';
import { loadEligiblePlayers } from '@/lib/cwl/roster';
import type { CWLConstraints } from '@/types/database';

/**
 * Create a CWL season and generate its recommended allocation in one pass.
 *
 * Body: { label, clans: [{ clanId, warSize }], constraints }
 * The season freezes a snapshot of `constraints`, the participating clans are recorded, then the
 * pure allocation engine runs over the whole eligible family pool and the result is persisted as
 * cwl_allocations plus a pending cwl_transfer for every player who must change clan.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const label: string = (body.label || '').trim();
    const clans: { clanId: string; warSize: number }[] = Array.isArray(body.clans) ? body.clans : [];
    const constraints: CWLConstraints = body.constraints ?? { default: { minThLevel: null, minLeague: null, maxBench: null }, perClan: {} };

    if (!label) return NextResponse.json({ error: 'A season label is required' }, { status: 400 });
    if (clans.length === 0) return NextResponse.json({ error: 'Select at least one clan for the season' }, { status: 400 });

    // 1. Create the season with its frozen constraint snapshot.
    const { data: season, error: seasonErr } = await supabase
      .from('cwl_seasons')
      .insert([{ label, status: 'planning', constraints }])
      .select('id')
      .single();
    if (seasonErr) throw seasonErr;
    const seasonId = season.id as string;

    // 2. Record the participating clans + their war size.
    const { error: clansErr } = await supabase.from('cwl_season_clans').insert(
      clans.map((c) => ({ season_id: seasonId, clan_id: c.clanId, war_size: c.warSize || 15 })),
    );
    if (clansErr) throw clansErr;

    // 3. Run the allocation engine over the eligible pool.
    const players = await loadEligiblePlayers();
    const pool: PoolClan[] = clans.map((c, i) => ({ clanId: c.clanId, warSize: c.warSize || 15, displayOrder: i }));
    const drafts = allocate(players, pool, constraints);

    // 4. Persist allocations, capturing ids so transfers can reference them.
    const { data: inserted, error: allocErr } = await supabase
      .from('cwl_allocations')
      .insert(
        drafts.map((d) => ({
          season_id: seasonId,
          person_id: d.personId,
          recommended_clan_id: d.recommendedClanId,
          actual_clan_id: d.actualClanId,
          status: d.status,
          is_bench: d.isBench,
          rank: d.rank,
          note: d.note,
        })),
      )
      .select('id, person_id');
    if (allocErr) throw allocErr;

    // 5. A pending transfer for every "must move clan" allocation.
    const allocIdByPerson = new Map((inserted || []).map((r) => [r.person_id as string, r.id as string]));
    const transferRows = drafts
      .filter((d) => d.status === 'transfer_required' && d.recommendedClanId)
      .map((d) => ({
        allocation_id: allocIdByPerson.get(d.personId)!,
        from_clan_id: d.actualClanId,
        to_clan_id: d.recommendedClanId,
        status: 'pending' as const,
      }))
      .filter((r) => r.allocation_id);
    if (transferRows.length) {
      const { error: transferErr } = await supabase.from('cwl_transfers').insert(transferRows);
      if (transferErr) throw transferErr;
    }

    return NextResponse.json({ success: true, seasonId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
