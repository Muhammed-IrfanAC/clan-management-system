/**
 * Attacker strength for CWL planning — the leadership's house rating, transcribed as data.
 *
 * Strength is judged purely on Ranked league against Town Hall: the same sub-division means
 * something very different at TH15 and TH18, so each TH carries its own bands. Offense is the only
 * input on purpose — defense was considered and dropped, since stronger THs bring better bases
 * naturally and the planner is about who should be attacking.
 *
 * Pure: no I/O, unit-tested beside it.
 */
import { UNRANKED_TIER } from './leagues';

export type AttackerStrength = 'strong' | 'medium' | 'weak';

/**
 * Per-TH bands as league-tier ORDINALS (see leagues.ts: Electro 31–33 = 31–33, Legend III/II/I =
 * 34/35/36). `strongFrom` and `mediumFrom` are inclusive floors; anything below `mediumFrom` is weak.
 *
 *   TH18  strong Legend III+   medium Electro 33   weak Electro 32 and below
 *   TH17  strong Electro 32+   medium Electro 31   weak Dragon 30 and below
 *   TH16  strong Electro 31+   medium Dragon 30    weak Dragon 29 and below
 *   TH15  strong Dragon 30+    medium Dragon 29    weak Dragon 28 and below
 *
 * Medium is deliberately a single tier: the first cut had two, and barely anyone rated strong.
 *
 * Every other TH is rated medium — the bands cover the main clans, and guessing finer for the rest
 * would be false precision.
 */
export const STRENGTH_BANDS: Readonly<Record<number, { goatFrom: number; strongFrom: number; mediumFrom: number }>> = {
  18: { goatFrom: 35, strongFrom: 34, mediumFrom: 33 },
  17: { goatFrom: 33, strongFrom: 32, mediumFrom: 31 },
  16: { goatFrom: 32, strongFrom: 31, mediumFrom: 30 },
  15: { goatFrom: 31, strongFrom: 30, mediumFrom: 29 },
};

/**
 * The GOAT highlight: the top of the strong band (TH18 Legend II+, TH17 Electro 33+, TH16 Electro
 * 32+, TH15 Electro 31+ — the original strong floors). Display only: a goat is rated `strong` for
 * every calculation; this just picks out the few strongest players on the page.
 */
export function isGoat(thLevel: number, leagueTier: number | null | undefined): boolean {
  const band = STRENGTH_BANDS[thLevel];
  return !!band && !isUnranked(leagueTier) && (leagueTier as number) >= band.goatFrom;
}

/**
 * True when the account has no Ranked league. Everyone in the family plays Ranked, so an unranked
 * account is not rated at all — it is kept out of CWL and leadership is told to mark it banned.
 */
export function isUnranked(leagueTier: number | null | undefined): boolean {
  return leagueTier == null || leagueTier <= UNRANKED_TIER;
}

/** Rate an attacker. Callers must check `isUnranked` first; an unranked account is rated weak here. */
export function rateStrength(thLevel: number, leagueTier: number | null | undefined): AttackerStrength {
  const band = STRENGTH_BANDS[thLevel];
  if (!band) return 'medium';
  const tier = isUnranked(leagueTier) ? 0 : (leagueTier as number);
  if (tier >= band.strongFrom) return 'strong';
  if (tier >= band.mediumFrom) return 'medium';
  return 'weak';
}
