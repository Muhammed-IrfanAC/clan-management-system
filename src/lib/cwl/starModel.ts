/**
 * Expected stars for one CWL attack — the planner's only predictive input.
 *
 * Leadership's model, kept deliberately simple:
 *  - A HIT DOWN (target below the attacker's TH) is always a triple, whatever the attacker's skill.
 *  - Otherwise the chance of a triple depends on the attacker's strength (strength.ts) and how many
 *    TH levels the target sits above them.
 *  - Anything that is not a triple is a "fail", and a fail is a 2★ 80% of the time and a 1★ 20% of
 *    the time regardless of skill — a one-star can happen on any fail and is not predictable per
 *    league, so it is not modelled as one.
 *
 * So E[stars] = 3·p + (1 − p)·(0.8·2 + 0.2·1) = 1.8 + 1.2·p.
 *
 * Pure: no I/O, unit-tested beside it.
 */
import type { AttackerStrength } from './strength';

/** Triple chance by strength, indexed by TH levels hit UP: [same TH, +1, +2, +3, +4 and beyond]. */
export const TRIPLE_CHANCE: Readonly<Record<AttackerStrength, readonly number[]>> = {
  strong: [1.0, 0.95, 0.9, 0.75, 0.25],
  medium: [0.95, 0.8, 0.6, 0.3, 0.0],
  weak: [0.75, 0.5, 0.1, 0.0, 0.0],
};

/** Of the attacks that are not triples, the share that end on one star (the rest are two-stars). */
export const FAIL_ONE_STAR_SHARE = 0.2;

/** Average stars of a fail: 2★ most of the time, 1★ the rest. */
const FAIL_EXPECTED_STARS = 2 * (1 - FAIL_ONE_STAR_SHARE) + 1 * FAIL_ONE_STAR_SHARE;

/** Probability this attacker triples a base `defenderTh` (the attacker's own TH is `attackerTh`). */
export function tripleChance(strength: AttackerStrength, attackerTh: number, defenderTh: number): number {
  if (defenderTh < attackerTh) return 1; // a hit down is always a triple
  const up = defenderTh - attackerTh;
  const table = TRIPLE_CHANCE[strength];
  return table[Math.min(up, table.length - 1)];
}

/** Expected stars of one attack. */
export function expectedStars(strength: AttackerStrength, attackerTh: number, defenderTh: number): number {
  const p = tripleChance(strength, attackerTh, defenderTh);
  return 3 * p + (1 - p) * FAIL_EXPECTED_STARS;
}
