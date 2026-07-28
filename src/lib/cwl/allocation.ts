import type { CWLConstraints, CWLAllocationStatus, CWLLeagueTierId } from '@/types/database';
import { readAllocationRule, type ResolvedRule } from './constraints';
import { tierOrder } from './leagues';

/**
 * CWL allocation engine — the single-pass, whole-family roster recommendation.
 *
 * This is the highest-risk piece of the module, so it is a PURE, side-effect-free function:
 * no Supabase, no I/O, fully deterministic and unit-testable. The API route feeds it the eligible
 * accounts + the participating clans + the season's frozen constraints and persists the result.
 *
 * The unit is an ACCOUNT, not a person (migration 026). CWL sign-up is per account, so a leader's
 * main and their two alts are three independent bodies that may each land in a different clan.
 *
 * PRIORITY WATERFALL
 * ------------------
 * Clans are filled in an explicit leader-controlled order (`priority`, 0 first), not by who has the
 * most room. That is the difference between "spread everyone evenly" and how a clan family actually
 * operates: the flagship clan is filled first and the feeders absorb what spills out of it.
 *
 * A clan's CAPACITY is `warSize + maxBench`, and the fill honours that capacity in one pass: walk the
 * clans in priority order and give each its strongest remaining eligible accounts until it is full,
 * bench included. Only then does the surplus spill to the next clan. So clan A is filled to a full
 * lineup AND its bench, A's spill feeds B, B's spill feeds C, and so on down the list.
 *
 * The bench is deliberately part of that capacity rather than a second pass over the clans. A bench
 * slot in clan A is a real, wanted position — the reserve for A's own war — so a player good enough
 * to sit on A's bench must not be pushed down into B's lineup to keep B full. Bench size is the
 * leader's lever here: a clan that should not hoard reserves is given a smaller `maxBench`, which is
 * a direct statement of intent, whereas filling every lineup before any bench silently overrode it
 * and left the bottom clan holding every reserve in the family.
 *
 * The cost is explicit and visible: if the family is short of bodies, a low-priority clan can end up
 * under its war size while a higher one holds a bench. That is the ordering doing exactly what it
 * was asked to do, and the roster board flags the short clan.
 *
 * Other guarantees:
 *  - Never double-books: the input is one entry per account, the output is one allocation per
 *    account, so an account can land in at most one clan.
 *  - Eligibility (min TH level, min Ranked tier) is resolved per-clan (perClan override falls back
 *    to the season default) at SUB-DIVISION granularity — 'Dragon 29+', not just 'Dragon+'.
 *  - Priority decides placement; a player's CURRENT clan is only a tie-break between equally strong
 *    candidates, so the top clan gets the strongest available lineup at the cost of more transfers.
 *  - Within a clan, accounts are ranked strongest-first; the top `warSize` are the fighting roster,
 *    the rest a ranked bench, capped so no clan ever benches more than its bench limit.
 *  - An account that fits nowhere is surfaced as 'removed' with an explaining note — eligible
 *    nowhere, or the whole family being full — never silently dropped.
 */

/** Default per-clan bench limit when a clan's rule leaves maxBench null. */
export const DEFAULT_MAX_BENCH = 5;

/** The effective bench limit for a clan: its rule's maxBench, else DEFAULT_MAX_BENCH. */
export function benchLimitForClan(constraints: CWLConstraints, clanId: string): number {
  return Math.max(0, readAllocationRule(constraints, clanId).maxBench ?? DEFAULT_MAX_BENCH);
}

// One eligible ACCOUNT and its live stats. personId is carried through for the profile link only —
// it is never used to group or de-duplicate, since a person's alts each get their own allocation.
export interface EligiblePlayer {
  playerTag: string;
  personId: string;
  name: string; // display name for this account (person name + alt marker, resolved by the loader)
  thLevel: number;
  leagueTier: CWLLeagueTierId | null; // Ranked sub-division ordinal 0–36 (null = unknown)
  currentClanId: string | null; // the account's current in-game clan (may be outside the pool)
}

export interface PoolClan {
  clanId: string;
  warSize: number; // 15 | 30
  // Fill order — 0 is filled first and absorbs the strongest players; later clans take the spill.
  // Ties (and clans left at the default 0) fall back to clanId for determinism.
  priority: number;
}

// A recommendation for one account — mirrors the persisted cwl_allocations shape (minus id/season).
export interface AllocationDraft {
  playerTag: string;
  personId: string;
  recommendedClanId: string | null;
  actualClanId: string | null;
  status: CWLAllocationStatus;
  isBench: boolean;
  rank: number | null;
  note: string | null;
}

/** The effective constraint rule for a clan: its per-clan override, else the season default. */
export function ruleForClan(constraints: CWLConstraints, clanId: string): ResolvedRule {
  return readAllocationRule(constraints, clanId);
}

/** Does an account clear a clan's hard eligibility gates (min TH level, min Ranked tier)? */
export function isEligible(player: EligiblePlayer, rule: ResolvedRule): boolean {
  if (rule.minThLevel != null && player.thLevel < rule.minThLevel) return false;
  if (rule.minLeagueTier != null && tierOrder(player.leagueTier) < rule.minLeagueTier) return false;
  return true;
}

// Raw fighting power, strongest first: higher TH, then higher Ranked sub-division. Returns 0 for
// two genuinely equivalent accounts, which is what lets a caller slot its own tie-break in below.
function byPower(a: EligiblePlayer, b: EligiblePlayer): number {
  if (b.thLevel !== a.thLevel) return b.thLevel - a.thLevel;
  return tierOrder(b.leagueTier) - tierOrder(a.leagueTier);
}

// Last-resort ordering so equal accounts never sort arbitrarily (allocation must be deterministic).
function byIdentity(a: EligiblePlayer, b: EligiblePlayer): number {
  return a.name.localeCompare(b.name) || a.playerTag.localeCompare(b.playerTag);
}

/** Strongest-first, used to rank a clan's final roster into fighting slots and bench. */
function byStrength(a: EligiblePlayer, b: EligiblePlayer): number {
  return byPower(a, b) || byIdentity(a, b);
}

/**
 * Strongest-first FOR A GIVEN CLAN: power decides, and only between EQUALLY powerful candidates does
 * the one already sitting in that clan win. Priority order still drives placement — the stay-put
 * preference sits below power, so it removes pointless transfers without ever costing a
 * higher-priority clan a stronger player.
 */
function byStrengthFor(clanId: string) {
  const stay = (p: EligiblePlayer) => (p.currentClanId === clanId ? 0 : 1);
  return (a: EligiblePlayer, b: EligiblePlayer): number =>
    byPower(a, b) || stay(a) - stay(b) || byIdentity(a, b);
}

/** Clans in fill order: priority ascending, ties broken by clanId so the result is deterministic. */
function inPriorityOrder(clans: PoolClan[]): PoolClan[] {
  return clans
    .slice()
    .sort((a, b) => a.priority - b.priority || a.clanId.localeCompare(b.clanId));
}

/**
 * Produce a recommended allocation for every eligible account across the whole clan pool.
 *
 * @param players  one entry per ACCOUNT signed into the season pool.
 * @param clans    the participating clans with their war size and fill priority.
 * @param constraints  the season's frozen rule set (default + per-clan overrides), including each
 *                     clan's minThLevel / minLeagueTier gates and its maxBench limit.
 * @param warIneligibleAccountTags  accounts pulled from CWL because they hold an active, unresolved
 *                     strike (war eligibility removed by the Strike system). Strikes are per-account,
 *                     so a struck alt never holds out its owner's other accounts. Struck accounts are
 *                     surfaced as 'removed' with an explaining note rather than silently dropped, so
 *                     a leader can override in the rare case they want to field one.
 */
export function allocate(
  players: EligiblePlayer[],
  clans: PoolClan[],
  constraints: CWLConstraints,
  warIneligibleAccountTags: ReadonlySet<string> = new Set(),
): AllocationDraft[] {
  const order = inPriorityOrder(clans);
  const ruleOf = new Map(order.map((c) => [c.clanId, ruleForClan(constraints, c.clanId)]));
  const capOf = new Map(
    order.map((c) => [c.clanId, c.warSize + benchLimitForClan(constraints, c.clanId)]),
  );

  const membersByClan = new Map<string, EligiblePlayer[]>(order.map((c) => [c.clanId, []]));

  // Pull war-ineligible (actively struck) accounts out of the pool up front — never placed.
  const warIneligible = players.filter((p) => warIneligibleAccountTags.has(p.playerTag));
  const remaining = players.filter((p) => !warIneligibleAccountTags.has(p.playerTag));

  const placed = new Set<string>();
  /** Give `clan` its strongest still-unplaced eligible accounts until it holds `upTo` players. */
  const fill = (clan: PoolClan, upTo: number) => {
    const roster = membersByClan.get(clan.clanId)!;
    const rule = ruleOf.get(clan.clanId)!;
    const candidates = remaining
      .filter((p) => !placed.has(p.playerTag) && isEligible(p, rule))
      .sort(byStrengthFor(clan.clanId));
    for (const player of candidates) {
      if (roster.length >= upTo) break;
      roster.push(player);
      placed.add(player.playerTag);
    }
  };

  // One pass down the priority order, each clan filled to lineup + bench before anything spills on.
  for (const clan of order) fill(clan, capOf.get(clan.clanId)!);

  // Rank each clan strongest-first; top `warSize` fight, the rest are the ranked bench. The cap
  // applied above guarantees that bench is at most `maxBench`.
  const drafts: AllocationDraft[] = [];
  for (const clan of order) {
    const members = membersByClan.get(clan.clanId)!;
    members.sort(byStrength);
    members.forEach((player, index) => {
      drafts.push({
        playerTag: player.playerTag,
        personId: player.personId,
        recommendedClanId: clan.clanId,
        actualClanId: player.currentClanId,
        status: clan.clanId === player.currentClanId ? 'matches' : 'transfer_required',
        isBench: index >= clan.warSize,
        rank: index,
        note: null,
      });
    });
  }

  // Unplaceable accounts — surfaced as 'removed' so a leader can override rather than silently drop.
  const unplaced = (player: EligiblePlayer, note: string): AllocationDraft => ({
    playerTag: player.playerTag,
    personId: player.personId,
    recommendedClanId: null,
    actualClanId: player.currentClanId,
    status: 'removed',
    isBench: false,
    rank: null,
    note,
  });

  for (const player of remaining) {
    if (placed.has(player.playerTag)) continue;
    const eligibleSomewhere = order.some((c) => isEligible(player, ruleOf.get(c.clanId)!));
    drafts.push(
      unplaced(
        player,
        eligibleSomewhere
          ? 'Family roster full — every eligible clan is at its bench limit'
          : 'No eligible clan in the season pool',
      ),
    );
  }
  for (const player of warIneligible) {
    drafts.push(unplaced(player, 'War-ineligible — active strike (trust restoration required)'));
  }

  return drafts;
}
