import type { CoCBattle, CoCLeagueHistoryEntry } from '@/lib/coc-api';
import { parseCoCTime } from '@/lib/cocTime';
import { LEAGUE_TIER_ID_BASE } from '@/lib/cwl/leagues';

/**
 * PURE roll-up of one Ranked League week for a clan: who played, who moved tier, and the top five in
 * offence and in defence. `rankedLoad.ts` is the DB/API half.
 *
 * Two API sources, because neither has everything. `/players/{tag}/leaguehistory` is the official
 * record of a finished week (trophies, placement, attacks made, defences and stars conceded) but its
 * `attackStars` is always 0. `/players/{tag}/battlelog` has per-attack stars but only the last ~50
 * battles, ranked and multiplayer mixed. So offence comes from the log, and is trusted only when the
 * log holds every ranked attack the history says was made that week; an account whose log has rolled
 * past part of the week is left out of the offence ranking rather than ranked on a partial week.
 * Defence comes from the history alone — the log misses defences more often than attacks.
 *
 * A week is identified by its `leagueSeasonId`, which is the week's start in Unix seconds: every week
 * runs Monday 05:00 UTC to the next Monday 05:00 UTC.
 */

export const RANKED_WEEK_SECONDS = 7 * 24 * 60 * 60;
/** A known week start (Monday 19 Oct 2026, 05:00 UTC). Every week starts a whole number of weeks from it. */
const WEEK_ANCHOR = 1792386000;

/** Results are published a few minutes after the reset; wait this long before reading them. */
export const POST_DELAY_MS = 30 * 60 * 1000;
/** Past this, a week's report is stale and is skipped rather than posted late. */
export const POST_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * How long after the reset an empty week is taken to mean "results not published yet" rather than
 * "nobody played". Past it, the report goes out without the league section.
 */
export const RESULTS_GRACE_MS = 3 * 60 * 60 * 1000;

export type RankedWeek = { seasonId: number; start: Date; end: Date };

export function weekStarting(seasonId: number): RankedWeek {
  return { seasonId, start: new Date(seasonId * 1000), end: new Date((seasonId + RANKED_WEEK_SECONDS) * 1000) };
}

/** The most recent week that has ended at `now`. */
export function lastEndedWeek(now: Date): RankedWeek {
  const elapsed = Math.floor(now.getTime() / 1000) - WEEK_ANCHOR;
  const current = WEEK_ANCHOR + Math.floor(elapsed / RANKED_WEEK_SECONDS) * RANKED_WEEK_SECONDS;
  return weekStarting(current - RANKED_WEEK_SECONDS);
}

/** Whether `now` falls in the window for posting `week`'s report. */
export function weeklyPostDue(now: Date, week: RankedWeek): boolean {
  const since = now.getTime() - week.end.getTime();
  return since >= POST_DELAY_MS && since < POST_WINDOW_MS;
}

/** Whether to hold the report back because nobody's results for the week are in yet. */
export function awaitingResults(now: Date, week: RankedWeek, played: number): boolean {
  return played === 0 && now.getTime() - week.end.getTime() < RESULTS_GRACE_MS;
}

export type RankedAccountInput = {
  tag: string;
  name: string | null;
  th: number | null;
  /** The account's tier now, after the reset — compared with the week's tier for promotion. */
  currentTierId: number | null;
  /** The ended week's history entry; null when the account did not play that week. */
  week: CoCLeagueHistoryEntry | null;
  /** The battle log; null when it could not be read. */
  battles: CoCBattle[] | null;
};

export type RankedAccountWeek = {
  tag: string;
  name: string | null;
  th: number | null;
  trophies: number;
  placement: number;
  tierId: number;
  /** 1 promoted, -1 demoted, 0 stayed, null when the current tier is unknown. */
  moved: 1 | 0 | -1 | null;
  /** Ranked attacks made, from the official history. */
  attacks: number;
  /** Whether the battle log holds every one of those attacks — the gate for the offence ranking. */
  offenceComplete: boolean;
  stars: number;
  triples: number;
  avgStars: number | null;
  avgDestruction: number | null;
  defences: number;
  defenceWins: number;
  starsConceded: number;
  avgConceded: number | null;
};

export type RankedWeekSummary = {
  week: RankedWeek;
  /** Accounts considered — the clan's active roster. */
  members: number;
  /** Of those, how many have a history entry for the week. */
  played: number;
  promoted: number;
  demoted: number;
  accounts: RankedAccountWeek[];
};

function battleSeconds(b: CoCBattle): number | null {
  const iso = parseCoCTime(b.battleTimestamp);
  return iso ? Math.floor(Date.parse(iso) / 1000) : null;
}

/** Ranked attacks from the log that fall inside the week. */
function weekAttacks(battles: CoCBattle[], week: RankedWeek): CoCBattle[] {
  const from = week.seasonId;
  const to = week.seasonId + RANKED_WEEK_SECONDS;
  return battles.filter((b) => {
    if (b.battleType !== 'ranked' || !b.attack) return false;
    const t = battleSeconds(b);
    return t != null && t >= from && t < to;
  });
}

function accountWeek(a: RankedAccountInput, w: CoCLeagueHistoryEntry, week: RankedWeek): RankedAccountWeek {
  const attacks = w.attackWins + w.attackLosses;
  const logged = a.battles ? weekAttacks(a.battles, week) : null;
  const offenceComplete = logged != null && logged.length === attacks;
  const counted = offenceComplete ? logged : [];
  const stars = counted.reduce((s, b) => s + b.stars, 0);
  const defences = w.defenseWins + w.defenseLosses;
  const moved =
    a.currentTierId == null ? null : a.currentTierId > w.leagueTierId ? 1 : a.currentTierId < w.leagueTierId ? -1 : 0;
  return {
    tag: a.tag,
    name: a.name,
    th: a.th,
    trophies: w.leagueTrophies,
    placement: w.placement,
    tierId: w.leagueTierId,
    moved,
    attacks,
    offenceComplete,
    stars,
    triples: counted.filter((b) => b.stars === 3).length,
    avgStars: counted.length ? stars / counted.length : null,
    avgDestruction: counted.length ? counted.reduce((s, b) => s + b.destructionPercentage, 0) / counted.length : null,
    defences,
    defenceWins: w.defenseWins,
    starsConceded: w.defenseStars,
    avgConceded: defences ? w.defenseStars / defences : null,
  };
}

export function summarizeRankedWeek(inputs: RankedAccountInput[], week: RankedWeek): RankedWeekSummary {
  const accounts = inputs
    .filter((a) => a.week && a.week.leagueSeasonId === week.seasonId)
    .map((a) => accountWeek(a, a.week!, week));
  return {
    week,
    members: inputs.length,
    played: accounts.length,
    promoted: accounts.filter((a) => a.moved === 1).length,
    demoted: accounts.filter((a) => a.moved === -1).length,
    accounts,
  };
}

/** The 0–36 ordinal of the tier an account played the week in (`cwl/leagues.ts`). */
export function tierOrdinal(a: { tierId: number }): number {
  return a.tierId - LEAGUE_TIER_ID_BASE;
}

type TopOptions = { limit?: number; minTier?: number };

/**
 * Best average stars per ranked attack, among accounts whose whole week is in their log. `minTier`
 * (an ordinal) keeps the ranking to one band of leagues: three stars in a low league is not the
 * same achievement as three stars in Legend, so ranking across all of them rewards the easier fights.
 */
export function topOffence(
  accounts: RankedAccountWeek[],
  { minAttacks = 4, limit = 5, minTier = 0 }: TopOptions & { minAttacks?: number } = {},
): RankedAccountWeek[] {
  return accounts
    .filter((a) => tierOrdinal(a) >= minTier && a.offenceComplete && a.attacks >= minAttacks && a.avgStars != null)
    .sort(
      (a, b) =>
        b.avgStars! - a.avgStars! ||
        b.triples - a.triples ||
        (b.avgDestruction ?? 0) - (a.avgDestruction ?? 0) ||
        b.trophies - a.trophies ||
        a.tag.localeCompare(b.tag),
    )
    .slice(0, limit);
}

/** Fewest stars conceded per defence; more defences held to that average ranks higher on a tie. `minTier` as for offence. */
export function topDefence(
  accounts: RankedAccountWeek[],
  { minDefences = 3, limit = 5, minTier = 0 }: TopOptions & { minDefences?: number } = {},
): RankedAccountWeek[] {
  return accounts
    .filter((a) => tierOrdinal(a) >= minTier && a.defences >= minDefences && a.avgConceded != null)
    .sort(
      (a, b) =>
        a.avgConceded! - b.avgConceded! ||
        b.defences - a.defences ||
        b.defenceWins - a.defenceWins ||
        a.tag.localeCompare(b.tag),
    )
    .slice(0, limit);
}
