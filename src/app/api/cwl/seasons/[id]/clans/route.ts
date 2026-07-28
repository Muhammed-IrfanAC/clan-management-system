import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

/**
 * Rearrange a season's clan pool: the fill PRIORITY order and each clan's war size.
 *
 * Body: { clans: [{ clanId, priority, warSize? }] }
 *
 * Priority is what the allocation engine waterfalls down (0 is filled first and absorbs the
 * strongest accounts; later clans take the spill), so this endpoint is how a leader expresses
 * "Ember is the flagship, Ash feeds it, Cinder takes the rest". It only records the arrangement —
 * the roster is not touched until the caller explicitly re-allocates, because regenerating discards
 * hand-edits and that must stay a deliberate second step.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: seasonId } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const clans: { clanId: string; priority: number; warSize?: number }[] = Array.isArray(body.clans) ? body.clans : [];
    if (clans.length === 0) return NextResponse.json({ error: 'No clans supplied' }, { status: 400 });

    // Only clans already in this season's pool may be touched — the payload arrives from the client,
    // so an id that isn't part of the season must not be able to create or repoint a row.
    const { data: existing, error: existingErr } = await supabase
      .from('cwl_season_clans')
      .select('id, clan_id')
      .eq('season_id', seasonId);
    if (existingErr) throw existingErr;

    const rowIdByClan = new Map(
      ((existing as { id: string; clan_id: string }[]) || []).map((r) => [r.clan_id, r.id]),
    );
    const unknown = clans.filter((c) => !rowIdByClan.has(c.clanId));
    if (unknown.length) {
      return NextResponse.json({ error: 'One or more clans are not part of this season' }, { status: 400 });
    }

    for (const c of clans) {
      const patch: { priority: number; war_size?: number } = { priority: Math.max(0, Math.trunc(c.priority)) };
      if (c.warSize === 15 || c.warSize === 30) patch.war_size = c.warSize;
      const { error } = await supabase
        .from('cwl_season_clans')
        .update(patch)
        .eq('id', rowIdByClan.get(c.clanId)!);
      if (error) throw error;
    }

    const { data: updated, error: readErr } = await supabase
      .from('cwl_season_clans')
      .select('clan_id, war_size, priority')
      .eq('season_id', seasonId)
      .order('priority', { ascending: true });
    if (readErr) throw readErr;

    return NextResponse.json({ success: true, clans: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
