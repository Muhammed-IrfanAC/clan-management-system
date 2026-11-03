import { describe, it, expect } from 'vitest';
import { observedWarOrder } from './warOrder';

describe('observedWarOrder', () => {
  it('scores the share of lineup-mates an account sat above, from -1 to +1', () => {
    const score = observedWarOrder([{ members: [{ tag: 'a', pos: 1 }, { tag: 'b', pos: 2 }, { tag: 'c', pos: 3 }] }]);
    expect(score.get('a')).toBe(1);
    expect(score.get('b')).toBe(0);
    expect(score.get('c')).toBe(-1);
  });

  it('combines several wars, and does not reward an account just for having more of them', () => {
    const score = observedWarOrder([
      { members: [{ tag: 'a', pos: 1 }, { tag: 'b', pos: 2 }] },
      { members: [{ tag: 'a', pos: 2 }, { tag: 'b', pos: 1 }] },
      { members: [{ tag: 'a', pos: 1 }, { tag: 'c', pos: 2 }] },
      { members: [{ tag: 'd', pos: 1 }, { tag: 'e', pos: 2 }] },
    ]);
    // a: above b once, below b once, above c once → 2 of 3.
    expect(score.get('a')).toBeCloseTo(1 / 3);
    // d sat above its only lineup-mate, in one war: still the top score.
    expect(score.get('d')).toBe(1);
  });

  it('gives no score to an account never fielded with another', () => {
    const score = observedWarOrder([{ members: [{ tag: 'solo', pos: 1 }] }]);
    expect(score.has('solo')).toBe(false);
  });
});
