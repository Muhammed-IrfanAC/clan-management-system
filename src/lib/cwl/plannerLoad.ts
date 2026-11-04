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
import type { ObservedLineup } from './warOrder';
import { loadAccountHistory } from './ratingLoad';
import { loadFamilyRanking } from './familyStrengthLoad';

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

type AccountEmbed = {
  in_game_name: string | null;
  th_level: number | null;
  league: string | null;
  league_tier_id: number | null;
  war_preference?: 'in' | 'out' | null;
  war_preference_checked_at?: string | null;
  status?: string | null;
};

const ACCOUNT_FIELDS = 'in_game_name, th_level, league, league_tier_id, war_preference, war_preference_checked_at, status';

/** How far back past lineups inform the war order — war weight drifts as bases are upgraded. */
const WAR_ORDER_WINDOW_DAYS = 45;
/** PostgREST returns at most this many rows per request, so longer reads are paged. */
const PAGE = 1000;

type AccountRow = AccountEmbed & { player_tag: string; person: { display_name: string } | null };

type GroupRow = { opponent_tag: string; is_own: boolean; members: { tag: string; name: string; th: number }[] };

function toRosterAccount(tag: string, account: AccountEmbed | null, personName: string | null): RosterAccount {
  return {
    playerTag: tag,
    name: account?.in_game_name || personName || tag,
    personName,
    thLevel: account?.th_level ?? 0,
    leagueTier: normalizeLeagueTier(account?.league ?? null, account?.league_tier_id ?? null),
    warPreference: account?.war_preference ?? null,
    warPreferenceCheckedAt: account?.war_preference_checked_at ?? null,
    ...(account?.status && account.status !== 'active' ? { leftFamily: true } : {}),
  };
}

type PositionRow = { round_id: string; player_tag: string; map_position: number | null };

/** Every row of a paged read, PAGE at a time. */
async function readAll(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<PositionRow[]> {
  const out: PositionRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data as PositionRow[]) || [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * The map positions these accounts were given in recent wars — CWL and regular, any family clan —
 * grouped into one lineup per war. Only pairs within the roster matter for ordering it, so only the
 * roster's own rows are read. See warOrder.ts for why positions, not profile data.
 */
async function loadLineupHistory(tags: string[]): Promise<ObservedLineup[]> {
  if (tags.length === 0) return [];
  const since = new Date(Date.now() - WAR_ORDER_WINDOW_DAYS * 86_400_000).toISOString();
  const [cwl, regular] = await Promise.all([
    readAll((from, to) =>
      supabase
        .from('cwl_war_members')
        .select('round_id, player_tag, map_position, round:cwl_rounds!inner(start_time)')
        .in('player_tag', tags)
        .gte('round.start_time', since)
        .order('id')
        .range(from, to),
    ),
    readAll((from, to) =>
      supabase
        .from('war_members')
        .select('round_id, player_tag, map_position, round:war_rounds!inner(start_time)')
        .in('player_tag', tags)
        .gte('round.start_time', since)
        .order('id')
        .range(from, to),
    ),
  ]);
  const byWar = new Map<string, ObservedLineup>();
  for (const [kind, rows] of [['cwl', cwl], ['war', regular]] as const) {
    for (const r of rows) {
      if (r.map_position == null) continue;
      const key = `${kind}:${r.round_id}`;
      const lineup = byWar.get(key) ?? { members: [] };
      lineup.members.push({ tag: r.player_tag, pos: r.map_position });
      byWar.set(key, lineup);
    }
  }
  return [...byWar.values()];
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
          `account:player_accounts(${ACCOUNT_FIELDS})`,
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
      .select(`player_tag, ${ACCOUNT_FIELDS}, person:persons(display_name)`)
      .in('player_tag', ownSignup.map((m) => m.tag));
    if (error) throw error;
    for (const a of (data as unknown as AccountRow[]) || []) {
      accounts.set(a.player_tag, toRosterAccount(a.player_tag, a, a.person?.display_name ?? null));
    }
  }
  const unrated = plannerRoster({ signup: ownSignup, accounts, planned, excluded });

  const rounds = (roundsRes.data as PlannerRound[]) || [];
  const [membersRes, lineupHistory, { ratings, carries }, ranking] = await Promise.all([
    rounds.length
      ? supabase
          .from('cwl_war_members')
          .select('round_id, player_tag, name, attacks_used, stars, map_position')
          .in('round_id', rounds.map((r) => r.id))
      : Promise.resolve({ data: [], error: null }),
    loadLineupHistory(unrated.map((a) => a.playerTag)),
    loadAccountHistory(unrated),
    // Labels are read against the whole family's ranking, so "goat" means the same here as on the
    // Strength page: one of its top five.
    loadFamilyRanking(),
  ]);
  if (membersRes.error) throw membersRes.error;
  const members = (membersRes.data as PlannerMember[]) || [];
  // Each account's attack-model rating, learned from its war history (absent = no history yet).
  const roster = unrated.map((a) => {
    const c = carries.get(a.playerTag);
    return {
      ...a,
      rating: ratings.get(a.playerTag) ?? null,
      leagueCarry: c ? { strength: c.strength, weekStart: c.from.weekStart, th: c.from.th, tier: c.from.tier } : null,
    };
  });

  return {
    warSize: clanRows.find((c) => c.clan_id === clanId)?.war_size ?? 15,
    roster,
    rounds,
    members,
    overrides: (overridesRes.data as OverrideRow[]) || [],
    flags,
    optedOut,
    groupClans: groupRows.filter((g) => !g.is_own),
    lineupHistory,
    ranking,
  };
}
