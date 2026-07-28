import { supabase } from '@/lib/supabase';
import { allocate, type PoolClan } from './allocation';
import { loadEligiblePlayers, loadWarIneligibleAccountTags } from './roster';
import type { CWLConstraints } from '@/types/database';

/**
 * Run the pure allocation engine for a season and persist the result.
 *
 * Shared by season creation and by an explicit re-allocate, which is what makes the clan priority
 * order actually usable: reordering the clans is only meaningful if the roster can be regenerated
 * against the new order without rebuilding the season.
 *
 * This REPLACES the season's allocation wholesale — every existing allocation row (and, by cascade,
 * its transfer records) is dropped first. Leader hand-edits made since the last run are therefore
 * lost, so callers must treat it as a destructive action and confirm with the user. That is the
 * honest shape of the operation: the engine produces one coherent whole-family roster, and merging
 * a fresh run into hand-edits would silently produce a roster neither the leader nor the engine
 * chose.
 */
export async function generateAllocation(seasonId: string): Promise<{ allocated: number }> {
  const { data: season, error: seasonErr } = await supabase
    .from('cwl_seasons')
    .select('id, constraints')
    .eq('id', seasonId)
    .single();
  if (seasonErr) throw seasonErr;

  const { data: clanRows, error: clansErr } = await supabase
    .from('cwl_season_clans')
    .select('clan_id, war_size, priority')
    .eq('season_id', seasonId);
  if (clansErr) throw clansErr;

  const pool: PoolClan[] = ((clanRows as { clan_id: string; war_size: number; priority: number }[]) || []).map(
    (c) => ({ clanId: c.clan_id, warSize: c.war_size || 15, priority: c.priority ?? 0 }),
  );
  if (pool.length === 0) throw new Error('This season has no participating clans');

  const constraints = season.constraints as CWLConstraints;
  const [players, warIneligible] = await Promise.all([
    loadEligiblePlayers(),
    loadWarIneligibleAccountTags(),
  ]);
  const drafts = allocate(players, pool, constraints, warIneligible);

  // Clear the previous run. cwl_transfers cascades off cwl_allocations, so this also drops the
  // stale pending-transfer list rather than leaving moves pointing at a roster that no longer exists.
  const { error: clearErr } = await supabase.from('cwl_allocations').delete().eq('season_id', seasonId);
  if (clearErr) throw clearErr;

  if (drafts.length === 0) return { allocated: 0 };

  const { data: inserted, error: allocErr } = await supabase
    .from('cwl_allocations')
    .insert(
      drafts.map((d) => ({
        season_id: seasonId,
        player_account_tag: d.playerTag,
        person_id: d.personId,
        recommended_clan_id: d.recommendedClanId,
        actual_clan_id: d.actualClanId,
        status: d.status,
        is_bench: d.isBench,
        rank: d.rank,
        note: d.note,
      })),
    )
    .select('id, player_account_tag');
  if (allocErr) throw allocErr;

  // A pending transfer for every "must move clan" allocation.
  const allocIdByTag = new Map(
    (inserted || []).map((r) => [r.player_account_tag as string, r.id as string]),
  );
  const transferRows = drafts
    .filter((d) => d.status === 'transfer_required' && d.recommendedClanId)
    .map((d) => ({
      allocation_id: allocIdByTag.get(d.playerTag)!,
      from_clan_id: d.actualClanId,
      to_clan_id: d.recommendedClanId,
      status: 'pending' as const,
    }))
    .filter((r) => r.allocation_id);
  if (transferRows.length) {
    const { error: transferErr } = await supabase.from('cwl_transfers').insert(transferRows);
    if (transferErr) throw transferErr;
  }

  return { allocated: drafts.length };
}
