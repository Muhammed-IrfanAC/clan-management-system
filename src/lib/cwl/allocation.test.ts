import { describe, it, expect } from 'vitest';
import {
  allocate,
  benchLimitForClan,
  isEligible,
  ruleForClan,
  type EligiblePlayer,
  type PoolClan,
} from './allocation';
import {
  tierOrder,
  tierLabel,
  tierFloorLabel,
  normalizeLeagueTier,
  majorFloorTier,
  CWL_LEAGUE_TIERS,
  CWL_LEAGUE_MAJORS,
} from './leagues';
import { readRule } from './constraints';
import type { CWLConstraints, CWLConstraintRule } from '@/types/database';

const NO_CONSTRAINTS: CWLConstraints = {
  default: { minThLevel: null, minLeagueTier: null, maxBench: null },
  perClan: {},
};

// A constraint set that only overrides the family-wide bench limit.
function benchCap(maxBench: number): CWLConstraints {
  return { default: { minThLevel: null, minLeagueTier: null, maxBench }, perClan: {} };
}

// An account in the pool. `tag` doubles as the identity and the readable label in assertions.
function acct(tag: string, opts: Partial<Omit<EligiblePlayer, 'playerTag'>> = {}): EligiblePlayer {
  return {
    playerTag: `#${tag}`,
    personId: opts.personId ?? `person-${tag}`,
    name: opts.name ?? tag,
    thLevel: opts.thLevel ?? 15,
    leagueTier: opts.leagueTier ?? null,
    currentClanId: opts.currentClanId ?? null,
  };
}

/** Ordinals used across the tests, from the official table. */
const DRAGON_28 = 28;
const DRAGON_29 = 29;
const DRAGON_30 = 30;
const LEGEND_III = 34;

const CLAN_A: PoolClan = { clanId: 'A', warSize: 2, priority: 0 };
const CLAN_B: PoolClan = { clanId: 'B', warSize: 2, priority: 1 };

const placedIn = (drafts: ReturnType<typeof allocate>, clanId: string) =>
  drafts.filter((d) => d.recommendedClanId === clanId);
const byTag = (drafts: ReturnType<typeof allocate>) =>
  Object.fromEntries(drafts.map((d) => [d.playerTag, d]));

describe('Ranked league tier table', () => {
  it('transcribes all 37 official tiers with contiguous ids', () => {
    expect(CWL_LEAGUE_TIERS).toHaveLength(37);
    CWL_LEAGUE_TIERS.forEach((tier, i) => {
      expect(tier.ordinal).toBe(i);
      expect(tier.id).toBe(105000000 + i);
    });
    expect(CWL_LEAGUE_TIERS[0].name).toBe('Unranked');
    expect(CWL_LEAGUE_TIERS[36].name).toBe('Legend I');
  });

  it('groups the 12 major tiers into three sub-divisions each', () => {
    expect(CWL_LEAGUE_MAJORS).toHaveLength(12);
    for (const group of CWL_LEAGUE_MAJORS) expect(group.tiers).toHaveLength(3);
    expect(CWL_LEAGUE_MAJORS.map((g) => g.key)).toEqual([
      'skeleton', 'barbarian', 'archer', 'wizard', 'valkyrie', 'witch',
      'golem', 'pekka', 'titan', 'dragon', 'electro', 'legend',
    ]);
  });

  it('orders sub-divisions within a major tier, not just across majors', () => {
    expect(tierOrder(DRAGON_28)).toBeLessThan(tierOrder(DRAGON_30));
    expect(tierOrder(DRAGON_30)).toBeLessThan(tierOrder(LEGEND_III));
    expect(tierOrder(null)).toBeLessThan(tierOrder(0)); // unknown sorts below even Unranked
  });

  it('labels a tier and an eligibility floor', () => {
    expect(tierLabel(DRAGON_29)).toBe('Dragon 29');
    expect(tierLabel(LEGEND_III)).toBe('Legend III');
    expect(tierLabel(null)).toBe('—');
    expect(tierFloorLabel(DRAGON_29)).toBe('Dragon 29+');
    expect(tierFloorLabel(null)).toBe('any league');
  });

  it('normalizes by official id first', () => {
    // The id wins even if the stored display name disagrees (a rename survives this).
    expect(normalizeLeagueTier('whatever', 105000029)).toBe(29);
    expect(normalizeLeagueTier(null, 105000036)).toBe(36);
  });

  it('normalizes exact API names to their sub-division', () => {
    expect(normalizeLeagueTier('Titan League 25')).toBe(25);
    expect(normalizeLeagueTier('Dragon League 30')).toBe(30);
    expect(normalizeLeagueTier('P.E.K.K.A League 22')).toBe(22);
    expect(normalizeLeagueTier('Legend I')).toBe(36);
    expect(normalizeLeagueTier('Unranked')).toBe(0);
  });

  it('degrades an unrecognised name to its major tier floor, never above it', () => {
    expect(normalizeLeagueTier('Dragon League')).toBe(majorFloorTier('dragon'));
    expect(normalizeLeagueTier('Dragon League')).toBe(DRAGON_28);
  });

  it('rejects the legacy trophy scale and unknown input', () => {
    expect(normalizeLeagueTier('Crystal League II')).toBeNull();
    expect(normalizeLeagueTier(null)).toBeNull();
    expect(normalizeLeagueTier('')).toBeNull();
  });
});

describe('frozen constraint snapshots', () => {
  it('reads a pre-026 major-tier rule as that major\'s lowest sub-division', () => {
    // 'dragon' meant "Dragon and up" when it was written — Dragon 28 is exactly that floor, so an
    // old season re-read today admits the same players, not a stricter set. The casts model a row
    // read back from a pre-026 snapshot, which has no minLeagueTier key at all.
    const legacy = (minLeague: 'dragon' | 'legend') =>
      ({ minThLevel: null, minLeague, maxBench: null }) as unknown as CWLConstraintRule;
    expect(readRule(legacy('dragon')).minLeagueTier).toBe(DRAGON_28);
    expect(readRule(legacy('legend')).minLeagueTier).toBe(LEGEND_III);
  });

  it('prefers an explicit sub-division over a legacy major tier', () => {
    const rule = readRule({ minThLevel: null, minLeagueTier: DRAGON_30, minLeague: 'dragon', maxBench: null });
    expect(rule.minLeagueTier).toBe(DRAGON_30);
  });

  it('treats an absent rule as no gates at all', () => {
    expect(readRule(null)).toEqual({ minThLevel: null, minLeagueTier: null, maxBench: null });
  });
});

describe('eligibility', () => {
  it('gates on min TH level', () => {
    const p = acct('p', { thLevel: 12 });
    expect(isEligible(p, { minThLevel: 13, minLeagueTier: null, maxBench: null })).toBe(false);
    expect(isEligible(p, { minThLevel: 12, minLeagueTier: null, maxBench: null })).toBe(true);
  });

  it('gates at SUB-DIVISION granularity, not just the major tier', () => {
    // The whole point of item 4: 'Dragon 30+' must exclude a Dragon 28 player that 'Dragon+' let in.
    const dragon28 = acct('d28', { leagueTier: DRAGON_28 });
    expect(isEligible(dragon28, { minThLevel: null, minLeagueTier: DRAGON_28, maxBench: null })).toBe(true);
    expect(isEligible(dragon28, { minThLevel: null, minLeagueTier: DRAGON_30, maxBench: null })).toBe(false);
    const dragon30 = acct('d30', { leagueTier: DRAGON_30 });
    expect(isEligible(dragon30, { minThLevel: null, minLeagueTier: DRAGON_30, maxBench: null })).toBe(true);
  });

  it('fails any league floor when the tier is unknown', () => {
    expect(isEligible(acct('u', { leagueTier: null }), { minThLevel: null, minLeagueTier: 1, maxBench: null })).toBe(false);
  });

  it('resolves per-clan overrides, falling back to the default', () => {
    const constraints: CWLConstraints = {
      default: { minThLevel: 10, minLeagueTier: null, maxBench: null },
      perClan: { A: { minThLevel: 14, minLeagueTier: LEGEND_III, maxBench: 3 } },
    };
    expect(ruleForClan(constraints, 'A').minLeagueTier).toBe(LEGEND_III);
    expect(ruleForClan(constraints, 'B').minLeagueTier).toBeNull();
    expect(ruleForClan(constraints, 'A').maxBench).toBe(3);
  });

  it('layers a per-clan override FIELD BY FIELD over the default', () => {
    // The override form labels every blank field "(inherit)", so an override that only names a
    // bench limit must not wipe the season's TH and league gates for that clan — nor the reverse,
    // which is what silently replaced an explicit season bench limit with the engine default.
    const constraints: CWLConstraints = {
      default: { minThLevel: 13, minLeagueTier: DRAGON_28, maxBench: 2 },
      perClan: {
        A: { minThLevel: null, minLeagueTier: null, maxBench: 0 },
        B: { minThLevel: 15, minLeagueTier: null, maxBench: null },
      },
    };
    const a = ruleForClan(constraints, 'A');
    expect(a).toEqual({ minThLevel: 13, minLeagueTier: DRAGON_28, maxBench: 0 });
    const b = ruleForClan(constraints, 'B');
    expect(b).toEqual({ minThLevel: 15, minLeagueTier: DRAGON_28, maxBench: 2 });
    expect(benchLimitForClan(constraints, 'B')).toBe(2); // not the built-in 5
  });
});

describe('allocate — per account', () => {
  it('never double-books an account', () => {
    const players = [
      acct('1', { currentClanId: 'A' }),
      acct('2', { currentClanId: 'A' }),
      acct('3', { currentClanId: 'B' }),
      acct('4', { currentClanId: null }),
    ];
    const drafts = allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS);
    const tags = drafts.map((d) => d.playerTag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(tags.sort()).toEqual(['#1', '#2', '#3', '#4']);
  });

  it('allocates every alt of one person independently, possibly to different clans', () => {
    // The core of item 2: three accounts owned by one human. The old person-keyed engine could
    // field only one of them; all three are real CWL bodies and must each get a slot.
    const players = [
      acct('main', { personId: 'irfan', thLevel: 17, currentClanId: 'A' }),
      acct('alt1', { personId: 'irfan', thLevel: 14, currentClanId: 'A' }),
      acct('alt2', { personId: 'irfan', thLevel: 11, currentClanId: 'A' }),
    ];
    const clans: PoolClan[] = [
      { clanId: 'A', warSize: 1, priority: 0 },
      { clanId: 'B', warSize: 1, priority: 1 },
      { clanId: 'C', warSize: 1, priority: 2 },
    ];
    const drafts = allocate(players, clans, benchCap(0));
    expect(drafts).toHaveLength(3);
    expect(drafts.every((d) => d.personId === 'irfan')).toBe(true);
    // One per clan, strongest into the highest-priority clan.
    expect(byTag(drafts)['#main'].recommendedClanId).toBe('A');
    expect(byTag(drafts)['#alt1'].recommendedClanId).toBe('B');
    expect(byTag(drafts)['#alt2'].recommendedClanId).toBe('C');
  });

  it('carries the person link through for the profile/display join', () => {
    const drafts = allocate([acct('x', { personId: 'p-1', currentClanId: 'A' })], [CLAN_A], NO_CONSTRAINTS);
    expect(drafts[0].personId).toBe('p-1');
    expect(drafts[0].playerTag).toBe('#x');
  });
});

describe('allocate — priority waterfall', () => {
  it('fills the highest-priority clan first and spills the rest downward', () => {
    // 5 accounts of descending strength, three 1v1 clans with no bench. Strongest -> A, next -> B…
    const players = Array.from({ length: 5 }, (_, i) => acct(`p${i}`, { thLevel: 17 - i, currentClanId: null }));
    const clans: PoolClan[] = [
      { clanId: 'A', warSize: 1, priority: 0 },
      { clanId: 'B', warSize: 1, priority: 1 },
      { clanId: 'C', warSize: 1, priority: 2 },
    ];
    const drafts = allocate(players, clans, benchCap(0));
    const map = byTag(drafts);
    expect(map['#p0'].recommendedClanId).toBe('A');
    expect(map['#p1'].recommendedClanId).toBe('B');
    expect(map['#p2'].recommendedClanId).toBe('C');
    expect(map['#p3'].status).toBe('removed');
    expect(map['#p4'].status).toBe('removed');
  });

  it('re-ordering priority re-orders the fill — the same pool, a different answer', () => {
    const players = [acct('strong', { thLevel: 17 }), acct('weak', { thLevel: 12 })];
    const base: PoolClan[] = [
      { clanId: 'A', warSize: 1, priority: 0 },
      { clanId: 'B', warSize: 1, priority: 1 },
    ];
    const first = byTag(allocate(players, base, benchCap(0)));
    expect(first['#strong'].recommendedClanId).toBe('A');

    // Swap the priorities: B is now the flagship and takes the strongest account.
    const swapped: PoolClan[] = [
      { clanId: 'A', warSize: 1, priority: 1 },
      { clanId: 'B', warSize: 1, priority: 0 },
    ];
    const second = byTag(allocate(players, swapped, benchCap(0)));
    expect(second['#strong'].recommendedClanId).toBe('B');
    expect(second['#weak'].recommendedClanId).toBe('A');
  });

  it('fills each clan to lineup AND bench before spilling to the next', () => {
    // 8 accounts, three 2v2 clans with maxBench 1 (cap 3). A takes 3 (2 fighting + 1 bench), B takes
    // 3, and only the last 2 reach C. A bench slot in A is a wanted position, so the 3rd-strongest
    // account benches at A rather than being pushed down into B's lineup.
    const players = Array.from({ length: 8 }, (_, i) => acct(`p${i}`, { thLevel: 17 - i }));
    const clans: PoolClan[] = [
      { clanId: 'A', warSize: 2, priority: 0 },
      { clanId: 'B', warSize: 2, priority: 1 },
      { clanId: 'C', warSize: 2, priority: 2 },
    ];
    const drafts = allocate(players, clans, benchCap(1));
    expect(drafts.filter((d) => d.status === 'removed')).toHaveLength(0);
    expect(placedIn(drafts, 'A')).toHaveLength(3);
    expect(placedIn(drafts, 'B')).toHaveLength(3);
    expect(placedIn(drafts, 'C')).toHaveLength(2);
    // The bench belongs to the clans that earned it by priority, not to the bottom of the order.
    expect(placedIn(drafts, 'A').filter((d) => d.isBench)).toHaveLength(1);
    expect(placedIn(drafts, 'B').filter((d) => d.isBench)).toHaveLength(1);
    expect(placedIn(drafts, 'C').filter((d) => d.isBench)).toHaveLength(0);
    // A's bench is the 3rd-strongest account overall — it did not spill into B's lineup.
    expect(placedIn(drafts, 'A').find((d) => d.isBench)!.playerTag).toBe('#p2');
  });

  it('leaves a low-priority clan short rather than raiding a higher clan for its bench', () => {
    // 5 accounts, two 2v2 clans with maxBench 1. A fills to capacity (3) and C gets only 2 — the
    // deliberate cost of the ordering, and why the roster board flags a short lineup.
    const players = Array.from({ length: 5 }, (_, i) => acct(`p${i}`, { thLevel: 17 - i }));
    const clans: PoolClan[] = [
      { clanId: 'A', warSize: 2, priority: 0 },
      { clanId: 'B', warSize: 3, priority: 1 },
    ];
    const drafts = allocate(players, clans, benchCap(1));
    expect(placedIn(drafts, 'A')).toHaveLength(3);
    expect(placedIn(drafts, 'A').filter((d) => d.isBench)).toHaveLength(1);
    expect(placedIn(drafts, 'B').filter((d) => !d.isBench)).toHaveLength(2); // one short of 3
  });

  it('breaks ties toward staying put, so equal players do not transfer for nothing', () => {
    // Two identically-strong accounts compete for clan A's single slot; the one already in A wins.
    const players = [
      acct('outsider', { thLevel: 15, name: 'aaa', currentClanId: 'B' }),
      acct('resident', { thLevel: 15, name: 'aaa', currentClanId: 'A' }),
    ];
    const clans: PoolClan[] = [
      { clanId: 'A', warSize: 1, priority: 0 },
      { clanId: 'B', warSize: 1, priority: 1 },
    ];
    const drafts = byTag(allocate(players, clans, benchCap(0)));
    expect(drafts['#resident'].recommendedClanId).toBe('A');
    expect(drafts['#resident'].status).toBe('matches');
    expect(drafts['#outsider'].recommendedClanId).toBe('B');
    expect(drafts['#outsider'].status).toBe('matches');
  });

  it('lets priority beat staying put when the higher-priority clan wants the stronger account', () => {
    // Deliberate contrast with the tie-break above: strength is NOT equal, so the flagship clan
    // takes the stronger player even though that costs a transfer.
    const players = [
      acct('weak_resident', { thLevel: 13, currentClanId: 'A' }),
      acct('strong_outsider', { thLevel: 17, currentClanId: 'B' }),
    ];
    const clans: PoolClan[] = [
      { clanId: 'A', warSize: 1, priority: 0 },
      { clanId: 'B', warSize: 1, priority: 1 },
    ];
    const drafts = byTag(allocate(players, clans, benchCap(0)));
    expect(drafts['#strong_outsider'].recommendedClanId).toBe('A');
    expect(drafts['#strong_outsider'].status).toBe('transfer_required');
    expect(drafts['#weak_resident'].recommendedClanId).toBe('B');
    expect(drafts['#weak_resident'].status).toBe('transfer_required');
  });

  it('skips a clan an account is ineligible for and places it further down the order', () => {
    const constraints: CWLConstraints = {
      default: { minThLevel: null, minLeagueTier: null, maxBench: null },
      perClan: { A: { minThLevel: null, minLeagueTier: LEGEND_III, maxBench: null } },
    };
    const players = [acct('x', { currentClanId: 'A', leagueTier: DRAGON_30 })];
    const drafts = allocate(players, [CLAN_A, CLAN_B], constraints);
    expect(drafts[0].recommendedClanId).toBe('B');
    expect(drafts[0].status).toBe('transfer_required');
  });

  it('resolves priority ties deterministically by clan id', () => {
    const players = [acct('only', { thLevel: 16 })];
    const clans: PoolClan[] = [
      { clanId: 'zeta', warSize: 1, priority: 0 },
      { clanId: 'alpha', warSize: 1, priority: 0 },
    ];
    expect(allocate(players, clans, benchCap(0))[0].recommendedClanId).toBe('alpha');
  });
});

describe('allocate — ranking, capacity and removals', () => {
  it('ranks by strength: top warSize fight, remainder benched', () => {
    const players = [
      acct('low', { currentClanId: 'A', thLevel: 12 }),
      acct('mid', { currentClanId: 'A', thLevel: 14 }),
      acct('high', { currentClanId: 'A', thLevel: 16 }),
    ];
    const drafts = byTag(allocate(players, [{ clanId: 'A', warSize: 2, priority: 0 }], NO_CONSTRAINTS));
    expect(drafts['#high'].rank).toBe(0);
    expect(drafts['#high'].isBench).toBe(false);
    expect(drafts['#mid'].rank).toBe(1);
    expect(drafts['#low'].rank).toBe(2);
    expect(drafts['#low'].isBench).toBe(true);
  });

  it('uses the Ranked sub-division as the tie-break when Town Hall is equal', () => {
    const players = [
      acct('weak', { currentClanId: 'A', thLevel: 16, leagueTier: DRAGON_28 }),
      acct('strong', { currentClanId: 'A', thLevel: 16, leagueTier: DRAGON_30 }),
    ];
    const drafts = byTag(allocate(players, [{ clanId: 'A', warSize: 5, priority: 0 }], NO_CONSTRAINTS));
    expect(drafts['#strong'].rank).toBe(0);
    expect(drafts['#weak'].rank).toBe(1);
  });

  it('flags a transfer when the current clan is not in the pool', () => {
    const drafts = allocate([acct('x', { currentClanId: 'OUTSIDER' })], [CLAN_A, CLAN_B], NO_CONSTRAINTS);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].status).toBe('transfer_required');
    expect(drafts[0].recommendedClanId).toBe('A');
    expect(drafts[0].actualClanId).toBe('OUTSIDER');
  });

  it('marks an account eligible nowhere as removed', () => {
    const constraints: CWLConstraints = {
      default: { minThLevel: null, minLeagueTier: LEGEND_III, maxBench: null },
      perClan: {},
    };
    const drafts = allocate([acct('x', { currentClanId: 'A', leagueTier: DRAGON_30 })], [CLAN_A, CLAN_B], constraints);
    expect(drafts[0].status).toBe('removed');
    expect(drafts[0].recommendedClanId).toBeNull();
    expect(drafts[0].note).toMatch(/no eligible clan/i);
  });

  it('caps a single over-full clan at warSize + maxBench, removing the surplus', () => {
    // 22 accounts, one 15v15 clan: it holds 20 (15 fighting + the default 5 bench) and 2 fall out.
    const players = Array.from({ length: 22 }, (_, i) => acct(`p${i}`, { currentClanId: 'A', thLevel: 16 - (i % 5) }));
    const drafts = allocate(players, [{ clanId: 'A', warSize: 15, priority: 0 }], NO_CONSTRAINTS);
    expect(placedIn(drafts, 'A')).toHaveLength(20);
    expect(placedIn(drafts, 'A').filter((d) => d.isBench)).toHaveLength(5);
    const removed = drafts.filter((d) => d.status === 'removed');
    expect(removed).toHaveLength(2);
    expect(removed[0].note).toMatch(/roster full/i);
  });

  it('surfaces genuinely surplus accounts as removed when the whole family is full', () => {
    const players = [
      acct('a', { currentClanId: 'A', thLevel: 16 }),
      acct('b', { currentClanId: 'A', thLevel: 15 }),
      acct('c', { currentClanId: 'A', thLevel: 14 }),
    ];
    const clans: PoolClan[] = [
      { clanId: 'A', warSize: 1, priority: 0 },
      { clanId: 'B', warSize: 1, priority: 1 },
    ];
    const drafts = allocate(players, clans, benchCap(0));
    const removed = drafts.filter((d) => d.status === 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].playerTag).toBe('#c'); // the weakest
    expect(drafts.filter((d) => d.isBench)).toHaveLength(0);
  });

  it('honours a per-clan bench limit override', () => {
    const constraints: CWLConstraints = {
      default: { minThLevel: null, minLeagueTier: null, maxBench: null },
      perClan: { A: { minThLevel: null, minLeagueTier: null, maxBench: 0 } },
    };
    const players = Array.from({ length: 6 }, (_, i) => acct(`p${i}`, { currentClanId: 'A', thLevel: 16 - i }));
    const drafts = allocate(players, [CLAN_A, CLAN_B], constraints);
    expect(placedIn(drafts, 'A')).toHaveLength(2);
    expect(placedIn(drafts, 'A').filter((d) => d.isBench)).toHaveLength(0); // A's override forbids benching
    expect(placedIn(drafts, 'B')).toHaveLength(4);
    expect(placedIn(drafts, 'B').filter((d) => d.isBench)).toHaveLength(2);
    expect(drafts.filter((d) => d.status === 'removed')).toHaveLength(0);
  });
});

describe('war-ineligible (struck) exclusion — matched on the account tag', () => {
  it('pulls a war-ineligible account from the pool and marks it removed with a reason', () => {
    const players = [
      acct('clean', { currentClanId: 'A', thLevel: 16 }),
      acct('struck', { currentClanId: 'A', thLevel: 15 }),
    ];
    const drafts = byTag(allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS, new Set(['#struck'])));
    expect(drafts['#struck'].status).toBe('removed');
    expect(drafts['#struck'].recommendedClanId).toBeNull();
    expect(drafts['#struck'].rank).toBeNull();
    expect(drafts['#struck'].note).toMatch(/war-ineligible/i);
    expect(drafts['#clean'].recommendedClanId).toBe('A');
  });

  it('excludes only the struck alt, never its owner\'s other accounts', () => {
    // Both accounts belong to one person; a strike is per account, so the clean main plays on.
    const players = [
      acct('main', { personId: 'irfan', currentClanId: 'A', thLevel: 16 }),
      acct('alt', { personId: 'irfan', currentClanId: 'A', thLevel: 13 }),
    ];
    const drafts = byTag(allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS, new Set(['#alt'])));
    expect(drafts['#main'].status).not.toBe('removed');
    expect(drafts['#main'].recommendedClanId).toBe('A');
    expect(drafts['#alt'].status).toBe('removed');
  });

  it('never fills a struck account into a war slot even when the clan has room', () => {
    const players = Array.from({ length: 3 }, (_, i) => acct(`p${i}`, { currentClanId: 'A', thLevel: 16 - i }));
    const drafts = allocate(players, [{ clanId: 'A', warSize: 3, priority: 0 }], NO_CONSTRAINTS, new Set(['#p2']));
    const placed = placedIn(drafts, 'A').map((d) => d.playerTag);
    expect(placed).not.toContain('#p2');
    expect(placed.sort()).toEqual(['#p0', '#p1']);
    expect(byTag(drafts)['#p2'].status).toBe('removed');
  });

  it('is a no-op when the ineligible set is empty (default arg)', () => {
    const players = [acct('1', { currentClanId: 'A' }), acct('2', { currentClanId: 'B' })];
    expect(allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS).filter((d) => d.status === 'removed')).toHaveLength(0);
  });

  it('still represents every account exactly once in the output', () => {
    const players = [
      acct('a', { currentClanId: 'A' }),
      acct('b', { currentClanId: 'A' }),
      acct('c', { currentClanId: 'B' }),
    ];
    const drafts = allocate(players, [CLAN_A, CLAN_B], NO_CONSTRAINTS, new Set(['#a', '#c']));
    expect(drafts.map((d) => d.playerTag).sort()).toEqual(['#a', '#b', '#c']);
  });
});
