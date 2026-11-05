import { describe, it, expect } from 'vitest';
import {
  attackerSkill,
  baseLogit,
  carriedStanding,
  COEFFICIENTS,
  leagueWeight,
  expectedStars,
  FAIL_STARS,
  LEAGUE_SPREAD,
  leagueStrength,
  leagueTopShare,
  mirrorChance,
  newcomerOffset,
  rateAccounts,
  ratedHistory,
  RATING,
  stepRating,
  tripleChance,
  UNKNOWN_LEAGUE_STRENGTH,
  UNRATED,
  type AccountRating,
  type StoredAttack,
} from './attackModel';
import { isUnranked } from './leagues';

const DAY = 86_400_000;

describe('skill', () => {
  it('weights a league by its TH: cheap where leagues are bunched, extra at TH18', () => {
    // The top ~0.5% at TH9 (tier 8) and at TH15 (Dragon 30): rarity is cheap where everyone sits in a few leagues.
    expect(leagueTopShare(9, 8)).toBeCloseTo(leagueTopShare(15, 30)!, 3);
    expect(attackerSkill(9, 8)).toBeLessThan(attackerSkill(15, 30));
    // TH18 carries its own correction on top of the spread weight.
    expect(leagueWeight(18)).toBeCloseTo(COEFFICIENTS.league + COEFFICIENTS.leagueTh18);
    expect(leagueWeight(18)).toBeGreaterThan(leagueWeight(17));
    expect(leagueWeight(19)).toBe(leagueWeight(18));
  });

  it('adds the rating to the league', () => {
    const r: AccountRating = { ...UNRATED, mean: 0.4, attacks: 100 };
    const settled: AccountRating = { ...UNRATED, attacks: 100 };
    expect(attackerSkill(17, 32, r)).toBeCloseTo(attackerSkill(17, 32, settled) + 0.4);
  });

  it('discounts an account new to our wars, less with every attack', () => {
    const after = (attacks: number): AccountRating => ({ ...UNRATED, attacks });
    expect(newcomerOffset(0)).toBeCloseTo(-RATING.newcomerPenalty);
    expect(newcomerOffset(4)).toBeCloseTo(-RATING.newcomerPenalty / Math.E);
    expect(newcomerOffset(40)).toBeGreaterThan(-0.001);
    expect(attackerSkill(16, 31)).toBeLessThan(attackerSkill(16, 31, after(3)));
    expect(mirrorChance(16, 31)).toBeLessThan(mirrorChance(16, 31, after(30)));
  });

  it('treats a missing or zero tier as unranked', () => {
    expect(isUnranked(null)).toBe(true);
    expect(isUnranked(0)).toBe(true);
    expect(isUnranked(1)).toBe(false);
  });
});

describe('league strength', () => {
  it('reads a tier as the share of players at that TH in it or above', () => {
    // TH17 Electro 32+ is the top ~4.4%, TH18 Electro 32+ the top ~34% (fitting data, ClashSpot Nov 2026).
    expect(leagueTopShare(17, 32)).toBeCloseTo(0.0437, 3);
    expect(leagueTopShare(18, 32)).toBeCloseTo(0.3409, 3);
    // The percentile, weighted by how spread out the TH's leagues are (TH17 ×1.10, TH9 ×0.43).
    expect(leagueStrength(17, 32)).toBeCloseTo(-Math.log10(0.0437) * LEAGUE_SPREAD[17], 2);
    expect(LEAGUE_SPREAD[18]).toBe(1);
    expect(LEAGUE_SPREAD[9]).toBeCloseTo(0.43, 2);
    expect(LEAGUE_SPREAD[16]).toBeCloseTo(1.26, 2);
  });

  it('falls back to the family median when the league is unknown and clamps odd THs', () => {
    expect(leagueStrength(16, null)).toBe(UNKNOWN_LEAGUE_STRENGTH);
    expect(leagueStrength(16, 0)).toBe(UNKNOWN_LEAGUE_STRENGTH);
    expect(leagueStrength(19, 30)).toBe(leagueStrength(18, 30));
    expect(leagueStrength(5, 3)).toBe(leagueStrength(7, 3));
  });
});

describe('baseLogit — parity with the fitting script', () => {
  // Fixtures printed by `scripts/attack-model/model.py --export` from the unrounded fit.
  it.each([
    [{ attackerTh: 17, defenderTh: 17, leagueTier: 32, cwl: true }, 1.7182],
    [{ attackerTh: 15, defenderTh: 17, leagueTier: 29, cwl: true }, 0.604],
    [{ attackerTh: 18, defenderTh: 17, leagueTier: 34, cwl: true }, 2.9784],
    [{ attackerTh: 12, defenderTh: 15, leagueTier: 20, cwl: false, cleanup: true, secondAttack: true }, -1.316],
    [{ attackerTh: 16, defenderTh: 17, leagueTier: 31, cwl: false, leagueImputed: true }, 1.6533],
    [{ attackerTh: 10, defenderTh: 14, leagueTier: 12, cwl: true }, -2.1653],
  ])('%o → %f', (ctx, logit) => {
    expect(baseLogit(ctx)).toBeCloseTo(logit, 2);
  });
});

describe('triple chance and expected stars', () => {
  const mirror = { attackerTh: 17, defenderTh: 17, leagueTier: 32, cwl: true };

  it('falls with every level hit up and rises with league', () => {
    const at = (up: number, tier = 32) => tripleChance({ ...mirror, defenderTh: 17 + up, leagueTier: tier });
    expect(at(-1)).toBeGreaterThan(at(0));
    expect(at(0)).toBeGreaterThan(at(1));
    expect(at(1)).toBeGreaterThan(at(2));
    expect(at(0, 34)).toBeGreaterThan(at(0, 32));
    expect(at(0, 32)).toBeGreaterThan(at(0, 30));
  });

  it('lifts or lowers the chance by the account’s rating', () => {
    const good: AccountRating = { ...UNRATED, mean: 0.5, variance: 0.05 };
    const bad: AccountRating = { ...UNRATED, mean: -0.5, variance: 0.05 };
    expect(tripleChance(mirror, good)).toBeGreaterThan(tripleChance(mirror));
    expect(tripleChance(mirror, bad)).toBeLessThan(tripleChance(mirror));
  });

  it('scores a fail lower only on a big hit-up', () => {
    const p = tripleChance(mirror);
    expect(expectedStars(mirror)).toBeCloseTo(3 * p + (1 - p) * FAIL_STARS.upToTwo);
    const reach = { ...mirror, attackerTh: 14, defenderTh: 17 };
    const q = tripleChance(reach);
    expect(expectedStars(reach)).toBeCloseTo(3 * q + (1 - q) * FAIL_STARS.threeOrMore);
  });
});

describe('rating filter — parity with the fitting script', () => {
  it('reproduces the exported synthetic history step by step', () => {
    const history = [
      { base: 1.2, at: 0, attackerTh: 16, cwl: false, tripled: true },
      { base: 0.4, at: 1 * DAY, attackerTh: 16, cwl: false, tripled: false },
      { base: 1.8, at: 5 * DAY, attackerTh: 16, cwl: true, tripled: true },
      { base: 0.9, at: 6 * DAY, attackerTh: 17, cwl: true, tripled: true }, // TH upgrade
      { base: 1.5, at: 40 * DAY, attackerTh: 17, cwl: true, tripled: false },
    ];
    const expected = [0.640547435895931, 0.4921372896134794, 0.797905095533148, 0.6494219491399313, 0.7892297984523761];
    let r: AccountRating = UNRATED;
    history.forEach((h, i) => {
      const step = stepRating(r, h.base, h);
      expect(step.predicted).toBeCloseTo(expected[i], 10);
      r = step.rating;
    });
    expect(r.mean).toBeCloseTo(-0.058246636322296985, 10);
    expect(r.variance).toBeCloseTo(0.1856081206923185, 10);
    expect(r.attacks).toBe(5);
  });

  it('never lets the variance exceed the prior, even after a TH upgrade', () => {
    let r: AccountRating = UNRATED;
    r = stepRating(r, 1, { tripled: true, at: 0, attackerTh: 15, cwl: true }).rating;
    const upgraded = stepRating(r, 1, { tripled: true, at: DAY, attackerTh: 16, cwl: true });
    expect(upgraded.rating.variance).toBeLessThan(RATING.priorVariance);
    expect(r.variance).toBeLessThan(RATING.priorVariance);
  });

  it('lowers the rating after a miss, a regular-war miss never more than a CWL one', () => {
    const cwl = stepRating(UNRATED, 1, { tripled: false, at: 0, attackerTh: 16, cwl: true }).rating;
    const regular = stepRating(UNRATED, 1, { tripled: false, at: 0, attackerTh: 16, cwl: false }).rating;
    expect(cwl.mean).toBeLessThanOrEqual(regular.mean);
    expect(regular.mean).toBeLessThan(0);
  });
});

describe('ratedHistory', () => {
  const row = (over: Partial<StoredAttack>): StoredAttack => ({
    round_id: 'w1', attack_order: 1, attacker_tag: '#A', attacker_th: 16, defender_tag: '#E1', defender_th: 16,
    stars: 3, first_seen_at: '2026-10-20T10:00:00Z', attacker_league_tier_id: 105000031, ...over,
  });

  it('drops hits on tripled bases, marks cleanups and second attacks', () => {
    const history = ratedHistory({
      regular: [
        row({ attack_order: 1, attacker_tag: '#A', defender_tag: '#E1', stars: 2 }),
        row({ attack_order: 2, attacker_tag: '#B', defender_tag: '#E1', stars: 3 }), // cleanup
        row({ attack_order: 3, attacker_tag: '#A', defender_tag: '#E1', stars: 1 }), // dead: base already tripled
        row({ attack_order: 4, attacker_tag: '#B', defender_tag: '#E2', stars: 3 }), // #B's second attack
      ],
      cwl: [],
      current: new Map(),
    });
    expect(history.map((h) => [h.attackerTag, h.cleanup, h.secondAttack, h.tripled])).toEqual([
      ['#A', false, false, false],
      ['#B', true, false, true],
      ['#B', false, true, true],
    ]);
    expect(history.every((h) => !h.cwl && h.leagueTier === 31 && !h.leagueImputed)).toBe(true);
  });

  it('falls back to today’s league for old rows, skips excluded wars and unranked attackers', () => {
    const history = ratedHistory({
      regular: [row({ round_id: 'hard', attacker_tag: '#A' })],
      cwl: [
        row({ round_id: 'c1', attacker_tag: '#A', attacker_league_tier_id: null }),
        row({ round_id: 'c1', attack_order: 2, attacker_tag: '#U', defender_tag: '#E2', attacker_league_tier_id: 105000000 }),
      ],
      current: new Map([['#A', { tier: 33, th: 16 }]]),
      excludedWars: new Set(['hard']),
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ attackerTag: '#A', cwl: true, leagueTier: 33, leagueImputed: true });
  });

  it('reads today’s tier at today’s TH for an attack made before an upgrade', () => {
    const [old] = ratedHistory({
      regular: [row({ attacker_th: 16, defender_th: 16, attacker_league_tier_id: null })],
      cwl: [],
      current: new Map([['#A', { tier: 33, th: 18 }]]),
    });
    expect(old).toMatchObject({ attackerTh: 16, leagueTier: 33, leagueTh: 18, leagueImputed: true });
    // Electro 33 is the top ~23% of TH18s but the top 0.03% of TH16s — the attack is judged on the first.
    expect(old.leagueStrength).toBeCloseTo(leagueStrength(18, 33)); // no kept weeks: nothing to carry
    expect(baseLogit(old)).toBeLessThan(baseLogit({ ...old, leagueTh: undefined, leagueStrength: undefined }));
    expect(leagueStrength(18, 33)).toBeLessThan(1);
  });

  it('rates accounts from the history, oldest attack first', () => {
    const history = ratedHistory({
      regular: [],
      cwl: [
        row({ round_id: 'c2', first_seen_at: '2026-10-22T10:00:00Z', stars: 3 }),
        row({ round_id: 'c1', first_seen_at: '2026-10-21T10:00:00Z', stars: 2 }),
      ],
      current: new Map(),
    });
    const r = rateAccounts(history).get('#A')!;
    expect(r.attacks).toBe(2);
    expect(r.lastAt).toBe(Date.parse('2026-10-22T10:00:00Z'));
  });
});

describe('carriedStanding', () => {
  const MON = Date.parse('2026-11-02T05:00:00Z'); // a Ranked week start
  const W = 7 * DAY;
  const now = MON + 2 * DAY;

  it('keeps a pre-upgrade standing: Legend III at TH17 beats Legend III at TH18', () => {
    const weeks = [{ weekStart: MON - W, th: 17, tier: 34 }];
    const c = carriedStanding(18, 34, weeks, now);
    expect(c.from).toEqual(weeks[0]);
    expect(c.strength).toBeGreaterThan(leagueStrength(18, 34));
    // The league part equals the TH17 week's, expressed at TH18.
    expect(leagueWeight(18) * c.strength).toBeCloseTo(leagueWeight(17) * leagueStrength(17, 34));
  });

  it('uses the own tier when it is the best, and ignores weeks outside the last eight or not yet finished', () => {
    expect(carriedStanding(17, 34, [{ weekStart: MON - W, th: 17, tier: 32 }], now)).toEqual({ strength: leagueStrength(17, 34), from: null });
    expect(carriedStanding(18, 30, [{ weekStart: MON - 9 * W, th: 17, tier: 34 }], now).from).toBeNull();
    expect(carriedStanding(18, 30, [{ weekStart: MON, th: 17, tier: 34 }], now).from).toBeNull();
    expect(carriedStanding(18, 30, [{ weekStart: MON - 8 * W, th: 17, tier: 34 }], now).from).not.toBeNull();
  });
});

describe('ratedHistory — kept Ranked weeks', () => {
  const row = (over: Partial<StoredAttack>): StoredAttack => ({
    round_id: 'w1', attack_order: 1, attacker_tag: '#A', attacker_th: 17, defender_tag: '#E1', defender_th: 17,
    stars: 3, first_seen_at: '2026-10-21T10:00:00Z', attacker_league_tier_id: null, ...over,
  });
  const weeks = new Map([['#A', [
    { weekStart: Date.parse('2026-10-12T05:00:00Z'), th: 17, tier: 34 },
    { weekStart: Date.parse('2026-10-19T05:00:00Z'), th: 17, tier: 33 },
  ]]]);

  it('takes an old attack’s league from its own week instead of today’s', () => {
    const [a] = ratedHistory({ regular: [row({})], cwl: [], current: new Map([['#A', { tier: 30, th: 18 }]]), weeks });
    expect(a).toMatchObject({ leagueTier: 33, leagueImputed: false });
    expect(a.leagueTh).toBeUndefined();
    // ...and carries the better week before it (Legend III the week of Oct 12).
    expect(a.leagueStrength).toBeCloseTo(leagueStrength(17, 34));
  });
});
