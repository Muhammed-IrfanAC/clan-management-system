import { describe, it, expect } from 'vitest';
import { labelAttacks, countsForHitRate, type AttackInput } from './attackClass';

function hit(order: number, defenderTag: string, stars: number): AttackInput {
  return { order, defenderTag, stars };
}

describe('labelAttacks', () => {
  it('labels the first attack on a base fresh', () => {
    const [a] = labelAttacks([hit(1, '#D1', 2)]);
    expect(a).toMatchObject({ kind: 'fresh', starsBefore: 0, newStars: 2 });
  });

  it('labels a follow-up on an unfinished base cleanup, crediting only the stars it added', () => {
    const [, b] = labelAttacks([hit(1, '#D1', 2), hit(2, '#D1', 3)]);
    expect(b).toMatchObject({ kind: 'cleanup', starsBefore: 2, newStars: 1 });
  });

  it('labels a hit on an already-tripled base dead — the post-clear loot hit', () => {
    const [, b] = labelAttacks([hit(1, '#D1', 3), hit(2, '#D1', 1)]);
    expect(b).toMatchObject({ kind: 'dead', starsBefore: 3, newStars: 0 });
    expect(countsForHitRate(b)).toBe(false);
  });

  it('a worse follow-up is still cleanup and adds no stars', () => {
    const [, b] = labelAttacks([hit(1, '#D1', 2), hit(2, '#D1', 1)]);
    expect(b).toMatchObject({ kind: 'cleanup', starsBefore: 2, newStars: 0 });
    expect(countsForHitRate(b)).toBe(true);
  });

  it('carries the best result forward, not the latest', () => {
    const out = labelAttacks([hit(1, '#D1', 3), hit(2, '#D1', 1), hit(3, '#D1', 2)]);
    expect(out.map((a) => a.kind)).toEqual(['fresh', 'dead', 'dead']);
  });

  it('tracks each base independently', () => {
    const out = labelAttacks([hit(1, '#D1', 3), hit(2, '#D2', 1), hit(3, '#D2', 3), hit(4, '#D1', 1)]);
    expect(out.map((a) => a.kind)).toEqual(['fresh', 'fresh', 'cleanup', 'dead']);
  });

  it('reconstructs from attack order, whatever order the rows arrive in', () => {
    const out = labelAttacks([hit(3, '#D1', 1), hit(1, '#D1', 3)]);
    expect(out.map((a) => [a.order, a.kind])).toEqual([[1, 'fresh'], [3, 'dead']]);
  });

  it('keeps the caller’s extra fields', () => {
    const [a] = labelAttacks([{ ...hit(1, '#D1', 3), attackerTag: '#A1' }]);
    expect(a.attackerTag).toBe('#A1');
  });

  it('a whole war: map cleared, then everyone farms one star', () => {
    const out = labelAttacks([
      hit(1, '#D1', 3),
      hit(2, '#D2', 2),
      hit(3, '#D2', 3),
      hit(4, '#D1', 1),
      hit(5, '#D2', 1),
    ]);
    const counted = out.filter(countsForHitRate);
    expect(counted.map((a) => a.order)).toEqual([1, 2, 3]);
    expect(out.reduce((s, a) => s + a.newStars, 0)).toBe(6); // the war score: 3 + 3
  });
});
