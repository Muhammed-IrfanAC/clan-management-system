import type {
  CWLConstraints,
  CWLConstraintRule,
  CWLAllocationStatus,
  CWLLeague,
} from '@/types/database';
import { leagueOrder } from './leagues';

/**
 * CWL allocation engine — the single-pass, whole-family roster recommendation.
 *
 * This is the highest-risk piece of the module, so it is a PURE, side-effect-free function:
 * no Supabase, no I/O, fully deterministic and unit-testable. The API route feeds it eligible
 * players + the participating clans + the season's frozen constraints and persists the result.
 *
 * Guarantees:
 *  - Never double-books: the input is one entry per person, the output is one allocation per
 *    person, so a person can land in at most one clan.
 *  - Eligibility (min TH level, min clan rank) is resolved per-clan (perClan override falls back
 *    to default).
 *  - Prefers a player's CURRENT clan when they are eligible there (minimises transfers); an
 *    eligible-nowhere player is left unrecommended ('removed') for a leader to handle.
 *  - Within a clan, players are ranked strongest-first; the top `warSize` are the fighting
 *    roster, the rest a ranked bench.
 *  - Caps each clan's roster at `warSize + maxBench` so no clan ever benches more than its bench
 *    limit. The limit is per-clan (constraints, falling back to DEFAULT_MAX_BENCH). Weakest
 *    over-the-cap players are relocated to a clan that still has room; a player who fits nowhere
 *    because the WHOLE family is full is surfaced as 'removed' (over the bench limit), never
 *    silently benched. A 15v15 clan with the default limit therefore benches at most 5.
 */

/** Default per-clan bench limit when a clan's rule leaves maxBench null. */
export const DEFAULT_MAX_BENCH = 5;

/** The effective bench limit for a clan: its rule's maxBench, else DEFAULT_MAX_BENCH. */
export function benchLimitForClan(constraints: CWLConstraints, clanId: string): number {
  return Math.max(0, ruleForClan(constraints, clanId).maxBench ?? DEFAULT_MAX_BENCH);
}

// One eligible player, keyed to a PERSON (their chosen CWL account's live stats).
export interface EligiblePlayer {
  personId: string;
  playerTag: string;
  name: string;
  thLevel: number;
  league: CWLLeague | null; // current Ranked league (null = unranked / unknown)
  currentClanId: string | null; // the account's current in-game clan (may be outside the pool)
}

export interface PoolClan {
  clanId: string;
  warSize: number; // 15 | 30
  // Tie-break for balancing/ranking determinism; lower sorts first. Optional (defaults to 0).
  displayOrder?: number;
}

// A recommendation for one person — mirrors the persisted cwl_allocations shape (minus id/season).
export interface AllocationDraft {
  personId: string;
  recommendedClanId: string | null;
  actualClanId: string | null;
  status: CWLAllocationStatus;
  isBench: boolean;
  rank: number | null;
  note: string | null;
}

/** The effective constraint rule for a clan: its per-clan override, else the season default. */
export function ruleForClan(constraints: CWLConstraints, clanId: string): CWLConstraintRule {
  return constraints.perClan[clanId] ?? constraints.default;
}

/** Does a player clear a clan's hard eligibility gates (min TH level, min Ranked league)? */
export function isEligible(player: EligiblePlayer, rule: CWLConstraintRule): boolean {
  if (rule.minThLevel != null && player.thLevel < rule.minThLevel) return false;
  if (rule.minLeague != null && leagueOrder(player.league) < leagueOrder(rule.minLeague)) return false;
  return true;
}

// Strongest-first comparator: higher TH, then higher league, then name (stable, deterministic).
function byStrength(a: EligiblePlayer, b: EligiblePlayer): number {
  if (b.thLevel !== a.thLevel) return b.thLevel - a.thLevel;
  const la = leagueOrder(a.league);
  const lb = leagueOrder(b.league);
  if (lb !== la) return lb - la;
  return a.name.localeCompare(b.name);
}

/**
 * Produce a recommended allocation for every eligible player across the whole clan pool.
 *
 * @param players  one entry per person (the account they'd play in CWL).
 * @param clans    the participating clans with their chosen war size.
 * @param constraints  the season's frozen rule set (default + per-clan overrides), including each
 *                     clan's minThLevel / minLeague gates and its maxBench limit.
 */
export function allocate(
  players: EligiblePlayer[],
  clans: PoolClan[],
  constraints: CWLConstraints,
  // Accounts pulled from CWL because they hold an active, unresolved strike (war eligibility removed
  // by the Strike system). Strikes are per-account, so a person is only excluded when the account
  // they'd field is struck — a struck alt doesn't hold them out. Struck players are surfaced as
  // 'removed' with an explaining note rather than silently dropped, so a leader can override in the
  // rare case they want to field a struck account.
  warIneligibleAccountTags: ReadonlySet<string> = new Set(),
): AllocationDraft[] {
  const poolById = new Map(clans.map((c) => [c.clanId, c]));
  const orderOf = (clanId: string) => poolById.get(clanId)?.displayOrder ?? 0;
  const rosterCap = (clanId: string) =>
    poolById.get(clanId)!.warSize + benchLimitForClan(constraints, clanId);

  const membersByClan = new Map<string, EligiblePlayer[]>();
  for (const c of clans) membersByClan.set(c.clanId, []);
  const roomInRoster = (clanId: string) => rosterCap(clanId) - membersByClan.get(clanId)!.length;
  const place = (player: EligiblePlayer, clanId: string) => membersByClan.get(clanId)!.push(player);

  // Pass 1 — retain players in their current clan (in pool + eligible there), but only up to the
  // roster cap. Rank each clan's stayers strongest-first and let the weakest over-the-cap players
  // spill into `displaced` so they can be relocated to a clan that still has room.
  const displaced: EligiblePlayer[] = [];
  const stayersByClan = new Map<string, EligiblePlayer[]>();
  for (const c of clans) stayersByClan.set(c.clanId, []);
  // Pull war-ineligible (actively struck) accounts out of the pool up front — they are never placed.
  const warIneligible = players.filter((p) => warIneligibleAccountTags.has(p.playerTag));
  const eligiblePool = players.filter((p) => !warIneligibleAccountTags.has(p.playerTag));
  for (const player of eligiblePool) {
    const cur = player.currentClanId;
    if (cur && poolById.has(cur) && isEligible(player, ruleForClan(constraints, cur))) {
      stayersByClan.get(cur)!.push(player);
    } else {
      displaced.push(player);
    }
  }
  for (const c of clans) {
    const stayers = stayersByClan.get(c.clanId)!;
    stayers.sort(byStrength);
    const cap = rosterCap(c.clanId);
    stayers.forEach((player, i) => (i < cap ? place(player, c.clanId) : displaced.push(player)));
  }

  // Pass 2 — place displaced players (strongest first) into the eligible pool clan with the most
  // remaining roster room, spreading bodies toward clans that still need them. A player eligible
  // somewhere but with no room left anywhere is 'over_capacity'; one eligible nowhere is 'removed'.
  const overCapacity: EligiblePlayer[] = [];
  const eligibleNowhere: EligiblePlayer[] = [];
  displaced.sort(byStrength);
  for (const player of displaced) {
    let best: string | null = null;
    let bestRoom = 0;
    let eligibleSomewhere = false;
    for (const c of clans) {
      if (!isEligible(player, ruleForClan(constraints, c.clanId))) continue;
      eligibleSomewhere = true;
      const room = roomInRoster(c.clanId);
      if (
        room > 0 &&
        (best === null || room > bestRoom || (room === bestRoom && orderOf(c.clanId) < orderOf(best)))
      ) {
        best = c.clanId;
        bestRoom = room;
      }
    }
    if (best) place(player, best);
    else if (eligibleSomewhere) overCapacity.push(player);
    else eligibleNowhere.push(player);
  }

  // Pass 3 — rank each clan strongest-first; top `warSize` fight, the rest are the ranked bench.
  // The roster cap guarantees this bench is at most `maxBench`.
  const drafts: AllocationDraft[] = [];
  for (const c of clans) {
    const members = membersByClan.get(c.clanId)!;
    members.sort(byStrength);
    members.forEach((player, index) => {
      const recommendedClanId = c.clanId;
      const status: CWLAllocationStatus =
        recommendedClanId === player.currentClanId ? 'matches' : 'transfer_required';
      drafts.push({
        personId: player.personId,
        recommendedClanId,
        actualClanId: player.currentClanId,
        status,
        isBench: index >= c.warSize,
        rank: index,
        note: null,
      });
    });
  }

  // Unplaceable players — surfaced as 'removed' so a leader can override rather than silently drop.
  for (const player of eligibleNowhere) {
    drafts.push({
      personId: player.personId,
      recommendedClanId: null,
      actualClanId: player.currentClanId,
      status: 'removed',
      isBench: false,
      rank: null,
      note: 'No eligible clan in the season pool',
    });
  }
  for (const player of overCapacity) {
    drafts.push({
      personId: player.personId,
      recommendedClanId: null,
      actualClanId: player.currentClanId,
      status: 'removed',
      isBench: false,
      rank: null,
      note: 'Family roster full — every eligible clan is at its bench limit',
    });
  }
  // War-ineligible (struck) players — recorded as 'removed' so the reason is visible to leaders.
  for (const player of warIneligible) {
    drafts.push({
      personId: player.personId,
      recommendedClanId: null,
      actualClanId: player.currentClanId,
      status: 'removed',
      isBench: false,
      rank: null,
      note: 'War-ineligible — active strike (trust restoration required)',
    });
  }

  return drafts;
}
