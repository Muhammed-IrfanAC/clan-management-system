/**
 * The in-game war-map order, learned from the wars our accounts actually fought.
 *
 * The game orders a war map by "war weight", which the CoC API does not expose. Across town halls
 * the map is almost exactly TH order, but WITHIN a town hall none of the profile data predicts it:
 * tested against six real CWL lineups, hero levels, equipment, pets, troops, spells and league tier
 * each got roughly 40–45% of same-TH pairs wrong — about a coin flip. War weight evidently comes
 * mostly from defences, which the API does not report.
 *
 * What does predict it is where the game already PUT each account. War weight changes slowly, so an
 * account's map position relative to the others in its past lineups (CWL and regular wars alike) is
 * a good guide to where it will sit next time. Leave-one-war-out on the same data: 4.9% of pairs
 * wrong, against 14.6% for the best profile-based proxy.
 *
 * Each account's score is its share of lineup-mates it sat ABOVE, from −1 (below everyone it was
 * ever fielded with) to +1 (above everyone): normalised so an account with more wars is not ranked
 * higher merely for having more data. An account with no shared lineup has no score (null), and the
 * planner places it after the scored accounts of its town hall, since nothing says where it belongs.
 *
 * Pure: no I/O, unit-tested beside it.
 */

/** One past war's lineup: each account's map position (1 = top). */
export interface ObservedLineup {
  members: { tag: string; pos: number }[];
}

export function observedWarOrder(lineups: ObservedLineup[]): Map<string, number> {
  const above = new Map<string, number>();
  const total = new Map<string, number>();
  for (const { members } of lineups) {
    for (const a of members) {
      for (const b of members) {
        if (a.tag === b.tag || a.pos === b.pos) continue;
        total.set(a.tag, (total.get(a.tag) ?? 0) + 1);
        if (a.pos < b.pos) above.set(a.tag, (above.get(a.tag) ?? 0) + 1);
      }
    }
  }
  const score = new Map<string, number>();
  for (const [tag, n] of total) score.set(tag, (2 * (above.get(tag) ?? 0)) / n - 1);
  return score;
}
