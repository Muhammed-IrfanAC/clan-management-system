import { supabase } from '@/lib/supabase';
import type { EligiblePlayer } from './allocation';
import { normalizeLeague } from './leagues';

/**
 * Server-side CWL roster helpers shared by the API routes: loading the eligible player pool and
 * keeping a player's required-transfer record in sync with their allocation. Kept out of the pure
 * `allocation` engine because these touch Supabase.
 */

type EligibleAccountRow = {
  player_tag: string;
  in_game_name: string | null;
  th_level: number | null;
  league: string | null;
  person_id: string;
  clan_id: string | null;
  is_main_account: boolean;
  person: { display_name: string } | null;
};

/**
 * Load one eligible player per PERSON for allocation. A person can have several linked accounts
 * across clans; CWL is played on a single account, so we pick their main account (falling back to
 * their highest-TH active account). Only active, person-linked accounts are considered.
 */
export async function loadEligiblePlayers(): Promise<EligiblePlayer[]> {
  const { data, error } = await supabase
    .from('player_accounts')
    .select('player_tag, in_game_name, th_level, league, person_id, clan_id, is_main_account, person:persons(display_name)')
    .eq('status', 'active')
    .not('person_id', 'is', null);
  if (error) throw error;

  const rows = (data as unknown as EligibleAccountRow[]) || [];

  // Choose the representative account per person: main account wins, else the highest TH level.
  const bestByPerson = new Map<string, EligibleAccountRow>();
  for (const row of rows) {
    const prev = bestByPerson.get(row.person_id);
    if (!prev) {
      bestByPerson.set(row.person_id, row);
      continue;
    }
    const prevScore = (prev.is_main_account ? 1000 : 0) + (prev.th_level ?? 0);
    const rowScore = (row.is_main_account ? 1000 : 0) + (row.th_level ?? 0);
    if (rowScore > prevScore) bestByPerson.set(row.person_id, row);
  }

  return Array.from(bestByPerson.values()).map((row) => ({
    personId: row.person_id,
    playerTag: row.player_tag,
    name: row.person?.display_name || row.in_game_name || row.player_tag,
    thLevel: row.th_level ?? 0,
    league: normalizeLeague(row.league),
    currentClanId: row.clan_id,
  }));
}

/**
 * Reconcile the pending-transfer record for an allocation against its recommended vs actual clan.
 *  - recommended matches actual (or removed): no move needed — drop any still-pending transfer.
 *  - recommended differs: ensure exactly one pending transfer (from actual → to recommended).
 * A transfer already marked done/missed is left untouched (it is history).
 */
export async function resyncTransfer(
  allocationId: string,
  actualClanId: string | null,
  recommendedClanId: string | null,
): Promise<void> {
  const { data: existing, error } = await supabase
    .from('cwl_transfers')
    .select('id, status')
    .eq('allocation_id', allocationId);
  if (error) throw error;

  const pending = (existing || []).find((t) => t.status === 'pending');
  const needsMove = !!recommendedClanId && recommendedClanId !== actualClanId;

  if (!needsMove) {
    // No move required anymore — clear a stale pending transfer (keep done/missed history).
    if (pending) {
      const { error: delErr } = await supabase.from('cwl_transfers').delete().eq('id', pending.id);
      if (delErr) throw delErr;
    }
    return;
  }

  if (pending) {
    const { error: updErr } = await supabase
      .from('cwl_transfers')
      .update({ from_clan_id: actualClanId, to_clan_id: recommendedClanId })
      .eq('id', pending.id);
    if (updErr) throw updErr;
  } else {
    const { error: insErr } = await supabase.from('cwl_transfers').insert([
      {
        allocation_id: allocationId,
        from_clan_id: actualClanId,
        to_clan_id: recommendedClanId,
        status: 'pending',
      },
    ]);
    if (insErr) throw insErr;
  }
}
