import { describe, it, expect } from 'vitest';
import {
  allocate,
  isEligible,
  ruleForClan,
  type EligiblePlayer,
  type PoolClan,
} from './allocation';
import { leagueOrder, normalizeLeague } from './leagues';
import type { CWLConstraints } from '@/types/database';

const NO_CONSTRAINTS: CWLConstraints = {
  default: { minThLevel: null, minLeague: null, maxBench: null },
  perClan: {},
};

// A constraint set that only overrides the family-wide bench limit.
function benchCap(maxBench: number): CWLConstraints {
  return { default: { minThLevel: null, minLeague: null, maxBench }, perClan: {} };
}

function player(
  personId: string,
  opts: Partial<Omit<EligiblePlayer, 'personId'>> = {},
): EligiblePlayer {
  return {
    personId,
    playerTag: `#${personId}`,
    name: opts.name ?? personId,
    thLevel: opts.thLevel ?? 15,
    league: opts.league ?? null,
    currentClanId: opts.currentClanId ?? null,
  };
}

const CLAN_A: PoolClan = { clanId: 'A', warSize: 2, displayOrder: 0 };
const CLAN_B: PoolClan = { clanId: 'B', warSize: 2, displayOrder: 1 };

describe('league helpers', () => {
  it('orders Ranked tiers lowest → highest', () => {
    expect(leagueOrder('skeleton')).toBeLessThan(leagueOrder('titan'));
    expect(leagueOrder('titan')).toBeLessThan(leagueOrder('dragon'));
    expect(leagueOrder('dragon')).toBeLessThan(leagueOrder('electro'));
    expect(leagueOrder('electro')).toBeLessThan(leagueOrder('legend'));
    expect(leagueOrder(null)).toBeLessThan(leagueOrder('skeleton')); // unknown sorts below all
  });

  it('normalizes raw CoC leagueTier names to major tiers', () => {
    expect(normalizeLeague('Titan League 25')).toBe('titan');
    expect(normalizeLeague('Dragon League 28')).toBe('dragon');
    expect(normalizeLeague('Electro League 31')).toBe('electro');
    expect(normalizeLeague('P.E.K.K.A League 22')).toBe('pekka');
    expect(normalizeLeague('Legend III')).toBe('legend');
    expect(normalizeLeague('Unranked')).toBeNull();
    expect(normalizeLeague('Crystal League II')).toBeNull(); // legacy trophy league — not this scale
    expect(normalizeLeague(null)).toBeNull();
  });

  it('gates on min TH level and min league', () => {
    const p = player('p', { thLevel: 12, league: 'dragon' });
    expect(isEligible(p, { minThLevel: 13, minLeague: null, maxBench: null })).toBe(false);
    expect(isEligible(p, { minThLevel: 12, minLeague: null, maxBench: null })).toBe(true);
    expect(isEligible(p, { minThLevel: null, minLeague: 'electro', maxBench: null })).toBe(false);
    expect(isEligible(p, { minThLevel: null, minLeague: 'dragon', maxBench: null })).toBe(true);
    // An unranked/unknown player fails any league floor.
    expect(isEligible(player('u', { league: null }), { minThLevel: null, minLeague: 'skeleton', maxBench: null })).toBe(false);
  });

  it('resolves per-clan overrides, falling back to the default', () => {
    const constraints: CWLConstraints = {
      default: { minThLevel: 10, minLeague: null, maxBench: null },
      perClan: { A: { minThLevel: 14, minLeague: 'legend', maxBench: 3 } },
    };
    expect(ruleForClan(constraints, 'A').minLeague).toBe('legend');
    expect(ruleForClan(constraints, 'B').minLeague).toBeNull();
    expect(ruleForClan(constraints, 'A').maxBench).toBe(3);
  });
});

describe('allocate', () => {
  it('never double-books a person', () => {
    const players = [
      player('1', { currentClanId: 'A' }),
      player('2', { currentClanId: 'A' }),
      player('3', { currentClanId: 'B' }),
      player('4', { currentClanId: null }),
    ];
    const drafts = allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS);
    const ids = drafts.map((d) => d.personId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(['1', '2', '3', '4']);
  });

  it('keeps eligible players in their current clan (status matches)', () => {
    const players = [player('1', { currentClanId: 'A' }), player('2', { currentClanId: 'B' })];
    const drafts = allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS);
    const byId = Object.fromEntries(drafts.map((d) => [d.personId, d]));
    expect(byId['1'].recommendedClanId).toBe('A');
    expect(byId['1'].status).toBe('matches');
    expect(byId['2'].recommendedClanId).toBe('B');
    expect(byId['2'].status).toBe('matches');
  });

  it('ranks by strength: top warSize fight, remainder benched (league breaks TH ties)', () => {
    const players = [
      player('low', { currentClanId: 'A', thLevel: 12 }),
      player('mid', { currentClanId: 'A', thLevel: 14 }),
      player('high', { currentClanId: 'A', thLevel: 16 }),
    ];
    const drafts = allocate(players, [{ clanId: 'A', warSize: 2 }], NO_CONSTRAINTS);
    const byId = Object.fromEntries(drafts.map((d) => [d.personId, d]));
    expect(byId['high'].rank).toBe(0);
    expect(byId['high'].isBench).toBe(false);
    expect(byId['mid'].rank).toBe(1);
    expect(byId['low'].rank).toBe(2);
    expect(byId['low'].isBench).toBe(true); // over the war size of 2 -> bench
  });

  it('uses league as the tie-break when Town Hall is equal', () => {
    const players = [
      player('weak', { currentClanId: 'A', thLevel: 16, league: 'dragon' }),
      player('strong', { currentClanId: 'A', thLevel: 16, league: 'legend' }),
    ];
    const drafts = allocate(players, [{ clanId: 'A', warSize: 5 }], NO_CONSTRAINTS);
    const byId = Object.fromEntries(drafts.map((d) => [d.personId, d]));
    expect(byId['strong'].rank).toBe(0);
    expect(byId['weak'].rank).toBe(1);
  });

  it('flags a transfer when the current clan is not in the pool', () => {
    const players = [player('x', { currentClanId: 'OUTSIDER' })];
    const drafts = allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe('transfer_required');
    expect(drafts[0].recommendedClanId).not.toBeNull();
    expect(drafts[0].actualClanId).toBe('OUTSIDER');
  });

  it('flags a transfer when a player is ineligible for their current clan', () => {
    const constraints: CWLConstraints = {
      default: { minThLevel: null, minLeague: null, maxBench: null },
      perClan: { A: { minThLevel: null, minLeague: 'legend', maxBench: null } },
    };
    // A Dragon-league player sits in clan A (now Legend-only) -> must move to B.
    const players = [player('x', { currentClanId: 'A', league: 'dragon' })];
    const drafts = allocate(players, [CLAN_A, CLAN_B], constraints);
    expect(drafts[0].recommendedClanId).toBe('B');
    expect(drafts[0].status).toBe('transfer_required');
  });

  it('marks a player eligible nowhere as removed', () => {
    const constraints: CWLConstraints = {
      default: { minThLevel: null, minLeague: 'legend', maxBench: null },
      perClan: {},
    };
    const players = [player('x', { currentClanId: 'A', league: 'dragon' })];
    const drafts = allocate(players, [CLAN_A, CLAN_B], constraints);
    expect(drafts[0].status).toBe('removed');
    expect(drafts[0].recommendedClanId).toBeNull();
    expect(drafts[0].note).toMatch(/no eligible clan/i);
  });

  it('caps a single over-full clan at warSize + maxBench benches, removing the surplus', () => {
    // 22 players all sitting in one 15v15 clan. Old behaviour benched 7; with the default
    // 5-bench cap the clan holds 20 (15 fighting + 5 bench) and 2 surplus fall out as removed.
    const players = Array.from({ length: 22 }, (_, i) =>
      player(`p${i}`, { currentClanId: 'A', thLevel: 16 - (i % 5) }),
    );
    const drafts = allocate(players, [{ clanId: 'A', warSize: 15 }], NO_CONSTRAINTS);
    const inA = drafts.filter((d) => d.recommendedClanId === 'A');
    const benched = inA.filter((d) => d.isBench);
    const removed = drafts.filter((d) => d.status === 'removed');
    expect(inA).toHaveLength(20);
    expect(benched).toHaveLength(5); // never more than maxBench
    expect(removed).toHaveLength(2);
    expect(removed[0].note).toMatch(/roster full/i);
  });

  it('relocates over-the-cap players into a clan that still has room', () => {
    // 6 players all in clan A, warSize 2 each, maxBench 1 -> cap 3 per clan. A keeps its
    // strongest 3, the other 3 spill into B (room 3). No one is removed; each clan benches ≤1.
    const players = Array.from({ length: 6 }, (_, i) => player(`p${i}`, { currentClanId: 'A', thLevel: 16 - i }));
    const clans: PoolClan[] = [
      { clanId: 'A', warSize: 2, displayOrder: 0 },
      { clanId: 'B', warSize: 2, displayOrder: 1 },
    ];
    const drafts = allocate(players, clans, benchCap(1));
    expect(drafts.filter((d) => d.status === 'removed')).toHaveLength(0);
    for (const clanId of ['A', 'B']) {
      const inClan = drafts.filter((d) => d.recommendedClanId === clanId);
      expect(inClan).toHaveLength(3);
      expect(inClan.filter((d) => d.isBench)).toHaveLength(1);
    }
  });

  it('surfaces genuinely surplus players as removed when the whole family is full', () => {
    // 3 players, two 1v1 clans, maxBench 0 -> total capacity 2. The third has nowhere to go.
    const players = [
      player('a', { currentClanId: 'A', thLevel: 16 }),
      player('b', { currentClanId: 'A', thLevel: 15 }),
      player('c', { currentClanId: 'A', thLevel: 14 }),
    ];
    const clans: PoolClan[] = [
      { clanId: 'A', warSize: 1, displayOrder: 0 },
      { clanId: 'B', warSize: 1, displayOrder: 1 },
    ];
    const drafts = allocate(players, clans, benchCap(0));
    const removed = drafts.filter((d) => d.status === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].personId).toBe('c'); // the weakest
    expect(drafts.filter((d) => d.isBench)).toHaveLength(0); // maxBench 0 -> no benches at all
  });

  it('honours a per-clan bench limit override', () => {
    // Clan A is capped at 0 bench (roster = warSize 2), clan B keeps the default. 6 players all
    // start in A: A holds exactly 2 (no bench), the other 4 spill into B (2 fight + 2 bench ≤ 5).
    const constraints: CWLConstraints = {
      default: { minThLevel: null, minLeague: null, maxBench: null },
      perClan: { A: { minThLevel: null, minLeague: null, maxBench: 0 } },
    };
    const players = Array.from({ length: 6 }, (_, i) => player(`p${i}`, { currentClanId: 'A', thLevel: 16 - i }));
    const clans: PoolClan[] = [
      { clanId: 'A', warSize: 2, displayOrder: 0 },
      { clanId: 'B', warSize: 2, displayOrder: 1 },
    ];
    const drafts = allocate(players, clans, constraints);
    const inA = drafts.filter((d) => d.recommendedClanId === 'A');
    const inB = drafts.filter((d) => d.recommendedClanId === 'B');
    expect(inA).toHaveLength(2);
    expect(inA.filter((d) => d.isBench)).toHaveLength(0); // A's override forbids benching
    expect(inB).toHaveLength(4);
    expect(inB.filter((d) => d.isBench)).toHaveLength(2);
    expect(drafts.filter((d) => d.status === 'removed')).toHaveLength(0);
  });

  it('spreads displaced players toward the clan with more remaining capacity', () => {
    const players = [
      player('a1', { currentClanId: 'A', thLevel: 16 }),
      player('a2', { currentClanId: 'A', thLevel: 16 }),
      player('drifter', { currentClanId: 'OUTSIDER', thLevel: 15 }),
    ];
    const clans: PoolClan[] = [
      { clanId: 'A', warSize: 3, displayOrder: 0 },
      { clanId: 'B', warSize: 3, displayOrder: 1 },
    ];
    const drafts = allocate(players, clans, NO_CONSTRAINTS);
    const drifter = drafts.find((d) => d.personId === 'drifter')!;
    expect(drifter.recommendedClanId).toBe('B');
  });

  describe('war-ineligible (struck) exclusion — matched on the fielded account tag', () => {
    it('pulls a war-ineligible account from the pool and marks it removed with a reason', () => {
      const players = [
        player('clean', { currentClanId: 'A', thLevel: 16 }),
        player('struck', { currentClanId: 'A', thLevel: 15 }),
      ];
      // The set holds account tags (player_account_tag), not person ids.
      const drafts = allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS, new Set(['#struck']));
      const struck = drafts.find((d) => d.personId === 'struck')!;
      expect(struck.status).toBe('removed');
      expect(struck.recommendedClanId).toBeNull();
      expect(struck.rank).toBeNull();
      expect(struck.note).toMatch(/war-ineligible/i);
      // The clean player is still allocated normally.
      expect(drafts.find((d) => d.personId === 'clean')!.recommendedClanId).toBe('A');
    });

    it('does NOT exclude a person when only a benched alt (a different account) is struck', () => {
      // The person fields their clean main #clean; their struck alt #alt is not in the pool. Because
      // eligibility is per-account, the struck alt tag must not hold the fielded account out.
      const players = [player('clean', { currentClanId: 'A', thLevel: 16 })];
      const drafts = allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS, new Set(['#alt']));
      expect(drafts[0].status).not.toBe('removed');
      expect(drafts[0].recommendedClanId).toBe('A');
    });

    it('never fills a struck account into a war slot even when the clan has room', () => {
      const players = Array.from({ length: 3 }, (_, i) =>
        player(`p${i}`, { currentClanId: 'A', thLevel: 16 - i }),
      );
      // #p2 is struck; warSize 3 has room for all three, but p2 must NOT be placed.
      const drafts = allocate(players, [{ clanId: 'A', warSize: 3 }], NO_CONSTRAINTS, new Set(['#p2']));
      const placed = drafts.filter((d) => d.recommendedClanId === 'A').map((d) => d.personId);
      expect(placed).not.toContain('p2');
      expect(placed.sort()).toEqual(['p0', 'p1']);
      expect(drafts.find((d) => d.personId === 'p2')!.status).toBe('removed');
    });

    it('is a no-op when the ineligible set is empty (default arg)', () => {
      const players = [player('1', { currentClanId: 'A' }), player('2', { currentClanId: 'B' })];
      const drafts = allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS);
      expect(drafts.filter((d) => d.status === 'removed')).toHaveLength(0);
    });

    it('still keeps every person represented exactly once in the output', () => {
      const players = [
        player('a', { currentClanId: 'A' }),
        player('b', { currentClanId: 'A' }),
        player('c', { currentClanId: 'B' }),
      ];
      const drafts = allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS, new Set(['#a', '#c']));
      const ids = drafts.map((d) => d.personId).sort();
      expect(ids).toEqual(['a', 'b', 'c']);
    });
  });
});
