import { supabase } from '@/lib/supabase';
import type { EligiblePlayer } from './allocation';
import { normalizeLeague } from './leagues';
import { STRIKE_WINDOW_DAYS } from '@/lib/strikes/status';

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
 * Load the set of account tags that are currently WAR-INELIGIBLE because of the Strike system: they
 * hold at least one active (not yet 90-day-expired) strike that leadership has not resolved
 * (leadership_approved = false). Strikes are per-account, so this excludes only the specific account —
 * a struck alt never holds out the person's other accounts. This mirrors `isWarEligible` in
 * lib/strikes/status.ts — an account is war-ineligible exactly when its unresolved-active strike count
 * is > 0. Fed to `allocate()` (matched against each person's fielded account) so struck accounts are
 * pulled from the CWL pool automatically. Fail-safe: on error returns an empty set (never blocks
 * allocation — worst case a struck account isn't auto-excluded and a leader sees them).
 */
export async function loadWarIneligibleAccountTags(): Promise<Set<string>> {
  // Expiry is derived, not stored (see 019_strike_system.sql), so filter on issued_at against the
  // same window constant the pure status module uses.
  const cutoffIso = new Date(Date.now() - STRIKE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('strikes')
    .select('player_account_tag')
    .gt('issued_at', cutoffIso) // still within the 90-day active window
    .eq('leadership_approved', false); // and not resolved/acknowledged by leadership
  if (error) {
    console.error('loadWarIneligibleAccountTags failed (non-fatal):', error);
    return new Set();
  }
  return new Set(
    (data as { player_account_tag: string | null }[] | null)
      ?.map((r) => r.player_account_tag)
      .filter((t): t is string => !!t) || [],
  );
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
