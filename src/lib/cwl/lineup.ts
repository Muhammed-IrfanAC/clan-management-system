/**
 * PLANNED vs ACTUAL lineup reconciliation.
 *
 * The CWL module holds two different pictures of a war and, until now, never compared them:
 *
 *   the PLAN    — cwl_allocations: who leadership signed up for this clan, and who they benched
 *   the REALITY — cwl_war_members: who the in-game roster actually fielded, read back from the API
 *
 * They drift constantly and legitimately. Someone is offline at reveal, a leader fills the slot from
 * the bench, a player transfers in late. Everything downstream already runs on REALITY — performance,
 * rotation fairness and the rule detectors all read the war rows, so a swapped-in player who misses
 * is struck and a planned player who never played is not. That is correct and this module does not
 * change it. What was missing is that nobody was TOLD the plan had diverged: the roster board kept
 * showing the formed lineup all week while the wars were fought by a different set of accounts.
 *
 * This is the one place that difference is computed, feeding both the round-reveal Discord notice
 * and the planned-vs-actual strip on the round card. Pure and side-effect free, in the same shape as
 * allocation.ts / rotation.ts — the classification rules are the fiddly part, so they get tests.
 */

/** One account the plan assigned to this clan for the season. */
export interface PlannedSlot {
  playerTag: string;
  name: string;
  isBench: boolean; // benched here = a wanted reserve for THIS clan, not an absentee
}

/** One account the in-game roster actually fielded in the round. */
export interface ActualSlot {
  playerTag: string;
  name: string;
  mapPosition?: number | null;
}

/**
 * Why an account is in the war without being a planned starter here. The distinction matters to a
 * leader reading the notice: promoting your own reserve is the system working, while an account the
 * season never assigned to this clan is a roster the plan does not describe at all.
 */
export type SwapInReason = 'from_bench' | 'unplanned';

export interface SwappedIn {
  playerTag: string;
  name: string;
  reason: SwapInReason;
}

export interface SwappedOut {
  playerTag: string;
  name: string;
}

export interface LineupDiff {
  swappedIn: SwappedIn[];
  swappedOut: SwappedOut[];
  asPlanned: number;      // planned starters who actually played
  plannedSize: number;    // planned starters (bench excluded)
  actualSize: number;     // bodies in the war
  matchesPlan: boolean;   // nothing swapped either way
}

/** Tags compare case-insensitively; the CoC API is consistent but stored tags come from several paths. */
function key(tag: string): string {
  return tag.trim().toUpperCase();
}

/**
 * Diff one round's in-game lineup against the plan for that clan.
 *
 * - swapped IN  = in the war, but not a planned starter here (either promoted off this clan's bench,
 *                 or not allocated to this clan at all)
 * - swapped OUT = a planned starter who is absent from the war
 *
 * A benched account that did NOT play is not "swapped out" — it is doing exactly what the plan said.
 * Both lists come back in the order they were supplied, so callers control presentation (the notice
 * feeds it map-position order; the board feeds it roster order).
 */
export function diffLineup(planned: PlannedSlot[], actual: ActualSlot[]): LineupDiff {
  const starters = new Set(planned.filter((p) => !p.isBench).map((p) => key(p.playerTag)));
  const bench = new Set(planned.filter((p) => p.isBench).map((p) => key(p.playerTag)));
  const fielded = new Set(actual.map((a) => key(a.playerTag)));

  const swappedIn: SwappedIn[] = [];
  for (const a of actual) {
    const k = key(a.playerTag);
    if (starters.has(k)) continue;
    swappedIn.push({
      playerTag: a.playerTag,
      name: a.name,
      reason: bench.has(k) ? 'from_bench' : 'unplanned',
    });
  }

  const swappedOut: SwappedOut[] = [];
  for (const p of planned) {
    if (p.isBench) continue; // benched by design — sitting out is the plan, not a swap
    if (fielded.has(key(p.playerTag))) continue;
    swappedOut.push({ playerTag: p.playerTag, name: p.name });
  }

  return {
    swappedIn,
    swappedOut,
    asPlanned: starters.size - swappedOut.length,
    plannedSize: starters.size,
    actualSize: actual.length,
    matchesPlan: swappedIn.length === 0 && swappedOut.length === 0,
  };
}
