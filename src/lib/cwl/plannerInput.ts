/**
 * The bridge from stored CWL rows to the planner's input (planner.ts) — for ONE clan in one season.
 *
 * Kept pure (rows in, PlannerInput out) so the rules for what counts as played, pending or still
 * open are unit-tested rather than buried in a store:
 *
 *  - A round is OPEN to planning until battle day begins: missing (not drawn yet) or in
 *    `preparation`, when the lineup can still be changed in game. `inWar` / `warEnded` are settled.
 *  - Stars so far are every star scored in a settled round.
 *  - An account in a war at battle day that has not attacked yet has stars on the way: it is given
 *    the model's expectation for its mirror base, so the planner neither re-plans it as if it had
 *    nothing nor counts an attack it has not made.
 *  - A round in preparation with a stored opponent lineup is a KNOWN enemy; any other open round is
 *    scored against the group's clans this clan has not been drawn against yet.
 */
import type { LineupBase } from '@/types/database';
import { slotExpectedStars, UNRATED, type AccountRating } from './attackModel';
import type { PlannerAccount, PlannerInput, PlannerRound } from './planner';
import type { FamilyRanking, LeagueCarryView } from './familyStrength';
import { observedWarOrder, type ObservedLineup } from './warOrder';

export const SEASON_ROUNDS = 7;

/**
 * How old an in-game war preference may be and still count. Sync re-reads it every ~10 minutes
 * while CWL runs and never outside it, so an older value is one that stopped being refreshed —
 * typically last month's toggle at the start of a new season — and is treated as unknown.
 */
export const WAR_PREFERENCE_MAX_AGE_MS = 60 * 60_000;

/** Is this account's stored war preference an "out" fresh enough to act on? */
export function optedOutInGame(
  a: Pick<SourceAccount, 'warPreference' | 'warPreferenceCheckedAt'>,
  now: number = Date.now(),
): boolean {
  if (a.warPreference !== 'out' || !a.warPreferenceCheckedAt) return false;
  return now - new Date(a.warPreferenceCheckedAt).getTime() <= WAR_PREFERENCE_MAX_AGE_MS;
}

export interface SourceAccount {
  playerTag: string;
  name: string;
  thLevel: number;
  leagueTier: number | null;
  /** Signed up but not in our database (never synced, or left the clan since) — league unknown. */
  untracked?: boolean;
  /** The in-game war toggle as last read by sync (migration 047); null/absent when never read. */
  warPreference?: 'in' | 'out' | null;
  warPreferenceCheckedAt?: string | null;
  /** The attack-model rating learned from the account's war history; null/absent = no history yet. */
  rating?: AccountRating | null;
  /** In our database but no longer in any family clan (left, or inactive) — e.g. left after signing up. */
  leftFamily?: boolean;
  /** A carried league standing (a recent week beating the current tier, e.g. before a TH upgrade). */
  leagueCarry?: LeagueCarryView | null;
}

export interface SourceRound {
  id: string;
  round_number: number;
  state: string | null;
  opponent_tag: string | null;
  opponent_lineup: LineupBase[] | null;
  team_size: number | null;
}

export interface SourceMember {
  round_id: string;
  player_tag: string;
  attacks_used: number;
  stars: number;
  map_position: number | null;
}

export interface SourceOverride {
  round_number: number;
  player_account_tag: string;
  mode: 'in' | 'out';
}

export interface SourceFlag {
  player_account_tag: string;
  flag: 'banned' | 'rule_breaker';
}

export interface SourceGroupClan {
  opponent_tag: string;
  members: { th: number }[];
}

/** An account on the planner's roster, with the person behind it when there is one. */
export interface RosterAccount extends SourceAccount {
  personName: string | null;
}

/**
 * Who the planner plans for, in one clan.
 *
 * Once the game has a CWL signup list for the clan, that list IS the roster: it is who leadership
 * signed in, and it includes accounts that are not linked to a person — rare in the main clans,
 * routine in the mini clan, and as much in need of their 8★ as anyone. Name, TH and Ranked tier come
 * from the synced account where there is one. The signup only carries name and TH, so an account we
 * have never synced (or that left the clan after signing up) is marked `untracked`: its league is
 * UNKNOWN, which is not the same as unranked, and the planner rates it as a typical family account
 * rather than excluding it. Accounts the clan lost to a ban or a season opt-out are kept on the list
 * so the page can lift the flag, even though they are not signed up.
 *
 * Before signup there is no in-game list yet, so the season's planned allocation stands in.
 */
export function plannerRoster(params: {
  signup: { tag: string; name: string; th: number }[] | null;
  accounts: ReadonlyMap<string, RosterAccount>;
  planned: RosterAccount[];
  excluded: RosterAccount[];
}): RosterAccount[] {
  const { signup, accounts, planned, excluded } = params;
  const base: RosterAccount[] = signup
    ? signup.map((m) => {
        const known = accounts.get(m.tag);
        return {
          playerTag: m.tag,
          name: known?.name || m.name || m.tag,
          personName: known?.personName ?? null,
          thLevel: known?.thLevel || m.th || 0,
          leagueTier: known?.leagueTier ?? null,
          warPreference: known?.warPreference ?? null,
          warPreferenceCheckedAt: known?.warPreferenceCheckedAt ?? null,
          ...(known?.leftFamily ? { leftFamily: true } : {}),
          ...(known ? {} : { untracked: true }),
        };
      })
    : planned;
  const seen = new Set(base.map((a) => a.playerTag));
  return [...base, ...excluded.filter((a) => !seen.has(a.playerTag))];
}

export interface PlannerSource {
  warSize: number;
  roster: SourceAccount[];
  /** This clan's rounds only. */
  rounds: SourceRound[];
  /** Member rows of those rounds. */
  members: SourceMember[];
  overrides: SourceOverride[];
  flags: SourceFlag[];
  optedOut: ReadonlySet<string>;
  groupClans: SourceGroupClan[];
  /** Recent lineups (CWL and regular wars) the roster was fielded in, for the war order. */
  lineupHistory?: ObservedLineup[];
  /** The clock for freshness checks; defaults to now (tests pin it). */
  now?: number;
  /** The family ranking the strength labels are read against (display only). */
  ranking?: FamilyRanking;
}

export function isSettled(state: string | null | undefined): boolean {
  return state === 'inWar' || state === 'warEnded';
}

/** The opponent's lineup as TH by map position, or null when nothing usable is stored. */
export function enemyThByPosition(lineup: LineupBase[] | null | undefined): number[] | null {
  if (!lineup || lineup.length === 0) return null;
  return lineup
    .slice()
    .sort((a, b) => (a.pos ?? Infinity) - (b.pos ?? Infinity))
    .map((b) => b.th);
}

/**
 * Each member's slot on the war map (1 = top), by round: the RANK of its map position among that
 * war's members. A CWL `mapPosition` is a position on the signed-up roster, benched accounts
 * included, so a 30v30 reads positions up to ~44 with gaps — usable for ordering, never as a slot.
 */
export function warMapSlots(members: readonly SourceMember[]): Map<string, number> {
  const byRound = new Map<string, SourceMember[]>();
  for (const m of members) {
    if (m.map_position == null) continue;
    byRound.set(m.round_id, [...(byRound.get(m.round_id) ?? []), m]);
  }
  const out = new Map<string, number>();
  for (const [roundId, list] of byRound) {
    list
      .slice()
      .sort((a, b) => a.map_position! - b.map_position!)
      .forEach((m, i) => out.set(`${roundId}:${m.player_tag}`, i + 1));
  }
  return out;
}

/**
 * Expected stars still to come from a war at battle day: every account in its lineup that has not
 * attacked yet, scored by the attack model against its mirror base (our slot k hits their slot k).
 * Keyed `${round_id}:${player_tag}`. This is what lets a leader plan the next war a few hours before
 * it starts, while the current one is still being fought, without the planner either ignoring those
 * attacks or counting them as already scored.
 */
export function livePendingStars(
  src: Pick<PlannerSource, 'roster' | 'rounds' | 'members'>,
): Map<string, number> {
  const liveById = new Map(src.rounds.filter((r) => r.state === 'inWar').map((r) => [r.id, r] as const));
  const accountByTag = new Map(src.roster.map((a) => [a.playerTag, a] as const));
  const slots = warMapSlots(src.members.filter((m) => liveById.has(m.round_id)));
  const out = new Map<string, number>();
  for (const m of src.members) {
    const live = liveById.get(m.round_id);
    if (!live || m.attacks_used > 0) continue;
    const key = `${m.round_id}:${m.player_tag}`;
    const acc = accountByTag.get(m.player_tag);
    const thLevel = acc?.thLevel ?? 0;
    const slot = slots.get(key);
    const defenderTh = (slot != null ? enemyThByPosition(live.opponent_lineup)?.[slot - 1] : undefined) ?? thLevel;
    out.set(
      key,
      slotExpectedStars(
        { attackerTh: thLevel, defenderTh, leagueTier: acc && !acc.untracked ? acc.leagueTier : null, cwl: true, leagueStrength: acc?.leagueCarry?.strength },
        acc?.rating ?? UNRATED,
      ),
    );
  }
  return out;
}

export function buildPlannerInput(src: PlannerSource): PlannerInput {
  const roundByNumber = new Map(src.rounds.map((r) => [r.round_number, r] as const));
  const settledIds = new Set(src.rounds.filter((r) => isSettled(r.state)).map((r) => r.id));

  // Latest known team size wins over the season setting — the game is the authority on war size.
  const drawn = src.rounds.filter((r) => r.team_size).sort((a, b) => b.round_number - a.round_number);
  const warSize = drawn[0]?.team_size ?? src.warSize;

  const stars = new Map<string, number>();
  for (const m of src.members) {
    if (!settledIds.has(m.round_id)) continue;
    stars.set(m.player_tag, (stars.get(m.player_tag) ?? 0) + m.stars);
  }
  const pending = new Map<string, number>();
  for (const [key, e] of livePendingStars(src)) {
    const tag = key.slice(key.indexOf(':') + 1);
    pending.set(tag, (pending.get(tag) ?? 0) + e);
  }

  const flagsByTag = new Map<string, Set<string>>();
  for (const f of src.flags) {
    const set = flagsByTag.get(f.player_account_tag) ?? new Set<string>();
    set.add(f.flag);
    flagsByTag.set(f.player_account_tag, set);
  }

  const warOrder = observedWarOrder(src.lineupHistory ?? []);
  // The in-game "out" toggle is a short-term request, so it applies to the next war only.
  const preferenceOut = new Set(src.roster.filter((a) => optedOutInGame(a, src.now)).map((a) => a.playerTag));

  const accounts: PlannerAccount[] = src.roster.map((a) => ({
    playerTag: a.playerTag,
    name: a.name,
    thLevel: a.thLevel,
    leagueTier: a.leagueTier,
    untracked: a.untracked,
    starsSoFar: stars.get(a.playerTag) ?? 0,
    pendingExpected: pending.get(a.playerTag) ?? 0,
    banned: flagsByTag.get(a.playerTag)?.has('banned') ?? false,
    ruleBreaker: flagsByTag.get(a.playerTag)?.has('rule_breaker') ?? false,
    optedOut: src.optedOut.has(a.playerTag),
    warOrder: warOrder.get(a.playerTag) ?? null,
    rating: a.rating ?? null,
    leagueCarry: a.leagueCarry ?? null,
  }));

  const rounds: PlannerRound[] = [];
  for (let n = 1; n <= SEASON_ROUNDS; n++) {
    const r = roundByNumber.get(n);
    if (r && isSettled(r.state)) continue;
    const overrides = src.overrides.filter((o) => o.round_number === n);
    rounds.push({
      roundNumber: n,
      enemyLineup: r ? enemyThByPosition(r.opponent_lineup) : null,
      forceIn: new Set(overrides.filter((o) => o.mode === 'in').map((o) => o.player_account_tag)),
      forceOut: new Set(overrides.filter((o) => o.mode === 'out').map((o) => o.player_account_tag)),
      ...(rounds.length === 0 ? { preferenceOut } : {}),
    });
  }

  // Opponents already drawn (in any round) are not still to come.
  const drawnTags = new Set(src.rounds.map((r) => r.opponent_tag).filter((t): t is string => !!t));
  const futureOpponents = src.groupClans
    .filter((g) => !drawnTags.has(g.opponent_tag))
    .map((g) => g.members.map((m) => m.th).filter((th) => Number.isFinite(th)));

  return { warSize, accounts, rounds, futureOpponents, ranking: src.ranking };
}
