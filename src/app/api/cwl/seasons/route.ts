import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { generateAllocation } from '@/lib/cwl/generate';
import type { CWLConstraints } from '@/types/database';

/**
 * Create a CWL season and generate its recommended allocation in one pass.
 *
 * Body: { label, clans: [{ clanId, warSize, priority? }], constraints }
 * The season freezes a snapshot of `constraints`, the participating clans are recorded with their
 * fill priority, then generateAllocation() runs the pure engine over the whole eligible family pool
 * and persists allocations + pending transfers.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const label: string = (body.label || '').trim();
    const clans: { clanId: string; warSize: number; priority?: number }[] = Array.isArray(body.clans) ? body.clans : [];
    const constraints: CWLConstraints = body.constraints ?? { default: { minThLevel: null, minLeagueTier: null, maxBench: null }, perClan: {} };

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

    // 2. Record the participating clans, their war size and their fill priority. The order the
    //    caller listed them in IS the priority when none is given — the form presents an explicitly
    //    ordered list, so position is the leader's intent.
    const { error: clansErr } = await supabase.from('cwl_season_clans').insert(
      clans.map((c, i) => ({
        season_id: seasonId,
        clan_id: c.clanId,
        war_size: c.warSize || 15,
        priority: c.priority ?? i,
      })),
    );
    if (clansErr) throw clansErr;

    // 3. Run the allocation engine over the eligible account pool and persist the result.
    await generateAllocation(seasonId);

    return NextResponse.json({ success: true, seasonId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
