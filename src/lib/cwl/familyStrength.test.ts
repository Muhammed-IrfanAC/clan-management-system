import { describe, it, expect } from 'vitest';
import { AWAY_MIN_WARS, familyCuts, GOAT_COUNT, onLeaderboard, rankedTier, rankFamily, skillTier } from './familyStrength';
import { attackerSkill, UNRATED } from './attackModel';

const tiersOf = (skills: number[]) => {
  const cuts = familyCuts(skills);
  return skills.map((s) => skillTier(s, cuts));
};

describe('familyCuts', () => {
  it('gives goat to the top five only, strong to the rest of the top quarter, weak to the bottom quarter', () => {
    const skills = Array.from({ length: 40 }, (_, i) => i / 10); // 40 accounts, all distinct
    const tiers = tiersOf(skills);
    const count = (t: string) => tiers.filter((x) => x === t).length;
    expect(count('goat')).toBe(GOAT_COUNT);
    expect(count('strong')).toBe(10 - GOAT_COUNT);
    expect(count('weak')).toBe(10);
    expect(count('medium')).toBe(20);
    // The very best are the goats, the very worst are weak.
    expect(skillTier(3.9, familyCuts(skills))).toBe('goat');
    expect(skillTier(0, familyCuts(skills))).toBe('weak');
  });

  it('keeps goat to five even when the top quarter is smaller', () => {
    const tiers = tiersOf([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]); // a quarter of 10 is 3
    expect(tiers.filter((t) => t === 'goat')).toHaveLength(5);
    expect(tiers.filter((t) => t === 'strong')).toHaveLength(0);
  });

  it('copes with a tiny family', () => {
    expect(tiersOf([1])).toEqual(['goat']);
    expect(tiersOf([])).toEqual([]);
  });
});

describe('rankFamily', () => {
  it('ranks by skill across town halls and leaves unranked accounts unrated at the end', () => {
    const settled = { ...UNRATED, attacks: 60 };
    const { accounts } = rankFamily([
      { playerTag: '#LOW', thLevel: 18, leagueTier: 30, rating: settled },
      { playerTag: '#UNRANKED', thLevel: 16, leagueTier: 0 },
      { playerTag: '#TOP', thLevel: 15, leagueTier: 31, rating: settled }, // top ~0.1% of TH15s
      { playerTag: '#FORM', thLevel: 18, leagueTier: 30, rating: { ...settled, mean: 1.2 } },
      { playerTag: '#NEW', thLevel: 15, leagueTier: 31 }, // the same league as #TOP, but no war record
    ]);
    expect(accounts.map((a) => [a.playerTag, a.rank])).toEqual([['#TOP', 1], ['#FORM', 2], ['#NEW', 3], ['#LOW', 4], ['#UNRANKED', null]]);
    expect(accounts[1].skill).toBeCloseTo(attackerSkill(18, 30, settled) + 1.2);
    expect(accounts[4]).toMatchObject({ tier: null, mirrorChance: null, skill: null });
    expect(accounts[0].mirrorChance).toBeGreaterThan(0.9);
  });
});

describe('rankedTier', () => {
  const { cuts, goats } = rankFamily(
    Array.from({ length: 20 }, (_, i) => ({ playerTag: `#R${i}`, thLevel: 17, leagueTier: 30, rating: { ...UNRATED, mean: i / 10, attacks: 20 } })),
  );

  it('keeps goat to the ranking’s top five', () => {
    expect(goats).toEqual(['#R19', '#R18', '#R17', '#R16', '#R15']);
    expect(rankedTier('#R19', attackerSkill(17, 30) + 1.9, { cuts, goats })).toBe('goat');
  });

  it('reads an account outside the ranking as strong at most, however high its skill', () => {
    // e.g. a signup who left the family since, in a very high league
    expect(rankedTier('#LEFT', cuts.goatFrom + 1, { cuts, goats })).toBe('strong');
    expect(rankedTier('#LEFT', attackerSkill(17, 30) - 5, { cuts, goats })).toBe('weak');
  });
});

describe('onLeaderboard', () => {
  it('ranks everyone in a family clan or signed up for our CWL, and an away account only while it keeps warring with us', () => {
    expect(onLeaderboard({ inFamily: true, recentWars: 0 })).toBe(true);
    expect(onLeaderboard({ inFamily: false, recentWars: 0, cwlSignup: true })).toBe(true);
    expect(onLeaderboard({ inFamily: false, recentWars: AWAY_MIN_WARS })).toBe(true);
    expect(onLeaderboard({ inFamily: false, recentWars: AWAY_MIN_WARS - 1 })).toBe(false);
    expect(AWAY_MIN_WARS).toBe(7);
  });
});
