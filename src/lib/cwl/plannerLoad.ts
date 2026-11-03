/**
 * Load everything the CWL war planner needs for one clan in one season — shared by the planner page's
 * store (in the browser) and by the Discord lineup post (on the server), so both work from the same
 * rows and therefore produce the same plan. Throws on any read error.
 */
import { supabase } from '@/lib/supabase';
import { normalizeLeagueTier } from './leagues';
import {
  plannerRoster,
  type PlannerSource,
  type RosterAccount,
  type SourceFlag,
  type SourceGroupClan,
  type SourceMember,
  type SourceOverride,
  type SourceRound,
} from './plannerInput';

export interface PlannerRound extends SourceRound {
  opponent_name: string | null;
}

export interface PlannerMember extends SourceMember {
  name: string | null;
}

export interface FlagRow extends SourceFlag {
  reason: string | null;
}

export interface OverrideRow extends SourceOverride {
  reason: string | null;
}

export interface PlannerData extends PlannerSource {
  roster: RosterAccount[];
  rounds: PlannerRound[];
  members: PlannerMember[];
  overrides: OverrideRow[];
  flags: FlagRow[];
  optedOut: Set<string>;
  groupClans: SourceGroupClan[];
}

type AccountEmbed = { in_game_name: string | null; th_level: number | null; league: string | null; league_tier_id: number | null };

type AccountRow = AccountEmbed & { player_tag: string; person: { display_name: string } | null };

type GroupRow = { opponent_tag: string; is_own: boolean; members: { tag: string; name: string; th: number }[] };

function toRosterAccount(tag: string, account: AccountEmbed | null, personName: string | null): RosterAccount {
  return {
    playerTag: tag,
    name: account?.in_game_name || personName || tag,
    personName,
    thLevel: account?.th_level ?? 0,
    leagueTier: normalizeLeagueTier(account?.league ?? null, account?.league_tier_id ?? null),
  };
}

type AllocationRow = {
  player_account_tag: string;
  recommended_clan_id: string | null;
  actual_clan_id: string | null;
  status: string;
  person: { display_name: string } | null;
  account: AccountEmbed | null;
};

export async function loadPlannerData(seasonId: string, clanId: string): Promise<PlannerData> {
  const [clansRes, allocRes, roundsRes, overridesRes, flagsRes, optoutRes, groupRes] = await Promise.all([
    supabase.from('cwl_season_clans').select('clan_id, war_size, priority').eq('season_id', seasonId),
    supabase
      .from('cwl_allocations')
      .select(
        'player_account_tag, recommended_clan_id, actual_clan_id, status, person:persons(display_name), ' +
          'account:player_accounts(in_game_name, th_level, league, league_tier_id)',
      )
      .eq('season_id', seasonId),
    supabase
      .from('cwl_rounds')
      .select('id, round_number, state, opponent_tag, opponent_name, opponent_lineup, team_size')
      .eq('season_id', seasonId)
      .eq('clan_id', clanId),
    supabase
      .from('cwl_round_overrides')
      .select('round_number, player_account_tag, mode, reason')
      .eq('season_id', seasonId)
      .eq('clan_id', clanId),
    supabase.from('cwl_player_flags').select('player_account_tag, flag, reason'),
    supabase.from('cwl_season_optouts').select('player_account_tag').eq('season_id', seasonId),
    supabase.from('cwl_group_clans').select('opponent_tag, members, is_own').eq('season_id', seasonId).eq('clan_id', clanId),
  ]);
  for (const r of [clansRes, allocRes, roundsRes, overridesRes, flagsRes, optoutRes, groupRes]) if (r.error) throw r.error;

  const clanRows = (clansRes.data as { clan_id: string; war_size: number; priority: number }[]) || [];
  const optedOut = new Set(((optoutRes.data as { player_account_tag: string }[]) || []).map((r) => r.player_account_tag));
  const flags = (flagsRes.data as FlagRow[]) || [];
  const banned = new Set(flags.filter((f) => f.flag === 'banned').map((f) => f.player_account_tag));

  const groupRows = (groupRes.data as GroupRow[]) || [];
  const ownSignup = groupRows.find((g) => g.is_own)?.members ?? null;

  // The planned roster (used until the game has a signup list) and the accounts the clan LOST to
  // a ban or an opt-out — those sit in the unassigned pile on the season board, but this page is
  // where a leader comes to lift the flag, so it has to list them.
  const allocations = (allocRes.data as unknown as AllocationRow[]) || [];
  const fromAllocation = (a: AllocationRow) => toRosterAccount(a.player_account_tag, a.account, a.person?.display_name ?? null);
  const planned = allocations.filter((a) => a.status !== 'removed' && a.recommended_clan_id === clanId).map(fromAllocation);
  const excluded = allocations
    .filter((a) => a.status === 'removed' && a.actual_clan_id === clanId)
    .filter((a) => banned.has(a.player_account_tag) || optedOut.has(a.player_account_tag))
    .map(fromAllocation);

  // Signed-up accounts are looked up by TAG, not through the person link, so an unlinked account
  // still gets its Ranked tier (the signup list carries only name and TH).
  const accounts = new Map<string, RosterAccount>();
  if (ownSignup?.length) {
    const { data, error } = await supabase
      .from('player_accounts')
      .select('player_tag, in_game_name, th_level, league, league_tier_id, person:persons(display_name)')
      .in('player_tag', ownSignup.map((m) => m.tag));
    if (error) throw error;
    for (const a of (data as unknown as AccountRow[]) || []) {
      accounts.set(a.player_tag, toRosterAccount(a.player_tag, a, a.person?.display_name ?? null));
    }
  }
  const roster = plannerRoster({ signup: ownSignup, accounts, planned, excluded });

  const rounds = (roundsRes.data as PlannerRound[]) || [];
  let members: PlannerMember[] = [];
  if (rounds.length) {
    const { data, error } = await supabase
      .from('cwl_war_members')
      .select('round_id, player_tag, name, attacks_used, stars, map_position')
      .in('round_id', rounds.map((r) => r.id));
    if (error) throw error;
    members = (data as PlannerMember[]) || [];
  }

  return {
    warSize: clanRows.find((c) => c.clan_id === clanId)?.war_size ?? 15,
    roster,
    rounds,
    members,
    overrides: (overridesRes.data as OverrideRow[]) || [],
    flags,
    optedOut,
    groupClans: groupRows.filter((g) => !g.is_own),
  };
}
