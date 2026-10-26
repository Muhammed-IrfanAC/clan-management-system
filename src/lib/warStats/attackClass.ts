/**
 * PURE attack labelling for war stats. No DB, no I/O.
 *
 * A raw 3-star rate punishes the wrong thing: once the map is cleared, members routinely take one
 * star off an already-tripled base for the loot and leave, and every one of those reads as a failed
 * attack. So each attack is labelled by the state of the base it hit, reconstructed from the
 * war-global attack `order` (the same reconstruction `rules/warContext.ts` uses for hit-ups):
 *
 *   fresh    — the first attack on that base
 *   cleanup  — the base had been hit before but was still short of three stars
 *   dead     — the base was ALREADY 3-starred before this attack; nothing was left to win
 *
 * Dead hits are excluded from hit rate (`countsForHitRate`). The rule is "the base was already
 * tripled" rather than "the whole map was cleared", which catches every post-clear loot hit and
 * also a wasted hit on a tripled base made before the clear — neither could have earned a star.
 *
 * Only OUR attacks are labelled: every attack on an enemy base is one of ours, so `war_attacks`
 * holds the complete history of each enemy base and the reconstruction needs nothing else.
 */

export type AttackKind = 'fresh' | 'cleanup' | 'dead';

export type AttackInput = {
  order: number;        // war-global attack order from the CoC API
  defenderTag: string;
  stars: number;
};

export type LabelledAttack<T extends AttackInput = AttackInput> = T & {
  kind: AttackKind;
  /** Best stars any earlier attack had taken off this base (0 when fresh). */
  starsBefore: number;
  /** Stars this attack added to the war score — war stars count only a base's best result. */
  newStars: number;
};

/** Label every attack of one war. Input order does not matter; output is sorted by `order`. */
export function labelAttacks<T extends AttackInput>(attacks: T[]): LabelledAttack<T>[] {
  const best = new Map<string, number>(); // defenderTag -> best stars so far
  return [...attacks]
    .sort((a, b) => a.order - b.order)
    .map((a) => {
      const prior = best.get(a.defenderTag);
      const starsBefore = prior ?? 0;
      const kind: AttackKind = prior === undefined ? 'fresh' : prior >= 3 ? 'dead' : 'cleanup';
      best.set(a.defenderTag, Math.max(starsBefore, a.stars));
      return { ...a, kind, starsBefore, newStars: Math.max(0, a.stars - starsBefore) };
    });
}

/** Whether an attack belongs in a hit-rate denominator: anything that could still earn a star. */
export function countsForHitRate(a: { kind: AttackKind }): boolean {
  return a.kind !== 'dead';
}
