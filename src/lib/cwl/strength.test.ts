import { describe, it, expect } from 'vitest';
import { rateStrength, isUnranked, isGoat } from './strength';
import { expectedStars, tripleChance } from './starModel';

// Tier ordinals: Dragon 28–30, Electro 31–33, Legend III/II/I = 34/35/36.
describe('rateStrength', () => {
  it.each([
    [18, 36, 'strong'], [18, 34, 'strong'], [18, 33, 'medium'], [18, 32, 'weak'],
    [17, 33, 'strong'], [17, 32, 'strong'], [17, 31, 'medium'], [17, 30, 'weak'],
    [16, 32, 'strong'], [16, 31, 'strong'], [16, 30, 'medium'], [16, 29, 'weak'],
    [15, 31, 'strong'], [15, 30, 'strong'], [15, 29, 'medium'], [15, 28, 'weak'],
  ])('TH%i at tier %i is %s', (th, tier, expected) => {
    expect(rateStrength(th, tier)).toBe(expected);
  });

  it('rates any TH outside the bands as medium', () => {
    expect(rateStrength(14, 10)).toBe('medium');
    expect(rateStrength(19, 36)).toBe('medium');
  });

  it('highlights goats at the top of the strong band without changing the rating', () => {
    expect(isGoat(18, 35)).toBe(true);
    expect(isGoat(18, 34)).toBe(false);
    expect(rateStrength(18, 35)).toBe('strong');
    expect(isGoat(17, 33)).toBe(true);
    expect(isGoat(16, 32)).toBe(true);
    expect(isGoat(15, 31)).toBe(true);
    expect(isGoat(15, 30)).toBe(false);
    expect(isGoat(14, 36)).toBe(false);
    expect(isGoat(18, null)).toBe(false);
  });

  it('treats a missing or zero tier as unranked', () => {
    expect(isUnranked(null)).toBe(true);
    expect(isUnranked(0)).toBe(true);
    expect(isUnranked(1)).toBe(false);
  });
});

describe('starModel', () => {
  it('always triples a hit down, whatever the strength', () => {
    expect(tripleChance('weak', 17, 15)).toBe(1);
    expect(tripleChance('medium', 16, 15)).toBe(1);
    expect(expectedStars('weak', 18, 17)).toBe(3);
  });

  it('uses the strength table for a same-TH hit', () => {
    expect(tripleChance('weak', 16, 16)).toBe(0.75);
  });

  it('clamps anything past +4 to the +4 chance', () => {
    expect(tripleChance('strong', 12, 18)).toBe(0.25);
  });

  it('scores a fail as 2★ 80% and 1★ 20%', () => {
    expect(expectedStars('strong', 16, 16)).toBeCloseTo(3);
    expect(expectedStars('medium', 16, 16)).toBeCloseTo(1.8 + 1.2 * 0.95);
    expect(expectedStars('weak', 16, 17)).toBeCloseTo(2.4);
    expect(expectedStars('medium', 16, 20)).toBeCloseTo(1.8);
  });
});
