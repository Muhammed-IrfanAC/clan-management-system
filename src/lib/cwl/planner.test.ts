import { describe, it, expect } from 'vitest';
import { planSeason, type PlannerAccount, type PlannerRound } from './planner';
import { attackerSkill, slotExpectedStars as expectedStars, slotTripleChance as tripleChance, UNRATED } from './attackModel';

// TH16 leagues: Electro 32 is the top ~0.3% of TH16s, Dragon 28 the top ~18%.
const STRONG = 32;
const WEAK = 28;
const cwl = (attackerTh: number, defenderTh: number, leagueTier: number | null) => ({ attackerTh, defenderTh, leagueTier, cwl: true });

function acc(tag: string, over: Partial<PlannerAccount> = {}): PlannerAccount {
  return { playerTag: tag, name: tag, thLevel: 16, leagueTier: STRONG, starsSoFar: 0, ...over };
}
function rounds(n: number, over: Partial<PlannerRound> = {}): PlannerRound[] {
  return Array.from({ length: n }, (_, i) => ({ roundNumber: i + 1, enemyLineup: null, ...over }));
}
const tagsOf = (slots: { playerTag: string }[]) => slots.map((s) => s.playerTag).sort();

describe('planSeason', () => {
  it('gets everyone to 8 stars when there is room', () => {
    const plan = planSeason({
      warSize: 3,
      accounts: ['a', 'b', 'c', 'd'].map((t) => acc(t)),
      rounds: rounds(7),
      futureOpponents: [],
    });
    expect(plan.totals.reachedClean).toBe(4);
    expect(plan.accounts.every((a) => a.status === 'on_track')).toBe(true);
    expect(plan.rounds.every((r) => r.lineup.length === 3)).toBe(true);
  });

  it('benches accounts already at 8 so chasers can play', () => {
    const plan = planSeason({
      warSize: 3,
      accounts: [
        acc('done1', { starsSoFar: 9 }), acc('done2', { starsSoFar: 8 }), acc('done3', { starsSoFar: 8 }),
        acc('c1'), acc('c2'), acc('c3'),
      ],
      rounds: rounds(3),
      futureOpponents: [],
    });
    for (const r of plan.rounds) {
      expect(tagsOf(r.lineup)).toEqual(['c1', 'c2', 'c3']);
      expect(r.bench.every((b) => b.reason === 'target_reached')).toBe(true);
    }
    expect(plan.totals.reachedClean).toBe(6);
  });

  it('puts clean accounts ahead of rule breakers when slots are scarce', () => {
    const plan = planSeason({
      warSize: 1,
      accounts: [acc('rb', { ruleBreaker: true }), acc('clean')],
      rounds: rounds(3),
      futureOpponents: [],
    });
    expect(plan.rounds.map((r) => r.lineup[0].playerTag)).toEqual(['clean', 'clean', 'clean']);
    expect(plan.accounts.find((a) => a.playerTag === 'rb')!.status).toBe('not_planned');
  });

  it('still plans rule breakers once clean accounts are covered', () => {
    const plan = planSeason({
      warSize: 1,
      accounts: [acc('rb', { ruleBreaker: true }), acc('clean')],
      rounds: rounds(6),
      futureOpponents: [],
    });
    expect(plan.totals).toMatchObject({ reachedClean: 1, reachedRuleBreakers: 1 });
  });

  it('sends a weak chaser into the easy war and the strong player into the tough one', () => {
    const plan = planSeason({
      warSize: 1,
      accounts: [acc('strong', { starsSoFar: 8 }), acc('weak', { leagueTier: WEAK, starsSoFar: 6 })],
      rounds: [
        { roundNumber: 1, enemyLineup: [18] }, // +2: the strong account loses less here
        { roundNumber: 2, enemyLineup: [14] }, // a hit down: a near-certain triple for anyone
      ],
      futureOpponents: [],
    });
    expect(plan.rounds[0].lineup[0].playerTag).toBe('strong');
    expect(plan.rounds[1].lineup[0].playerTag).toBe('weak');
    expect(plan.rounds[0].lineup[0].enemyTh).toBe(18);
  });

  it('does not spend slots on a chaser who cannot reach the target', () => {
    const plan = planSeason({
      warSize: 1,
      accounts: [acc('done', { starsSoFar: 8 }), acc('hopeless', { leagueTier: WEAK })],
      rounds: rounds(1),
      futureOpponents: [],
    });
    expect(plan.rounds[0].lineup[0].playerTag).toBe('done');
    expect(plan.rounds[0].bench).toEqual([expect.objectContaining({ playerTag: 'hopeless', reason: 'not_reachable' })]);
  });

  it('never plans banned, opted-out or unranked accounts', () => {
    const plan = planSeason({
      warSize: 3,
      accounts: [
        acc('ok'), acc('banned', { banned: true }), acc('away', { optedOut: true }), acc('unranked', { leagueTier: null }),
      ],
      rounds: rounds(2),
      futureOpponents: [],
    });
    for (const r of plan.rounds) {
      expect(tagsOf(r.lineup)).toEqual(['ok']);
      expect(r.shortBy).toBe(2);
      expect(r.unavailable.map((u) => u.reason).sort()).toEqual(['banned', 'opted_out', 'unranked']);
    }
    expect(plan.accounts.find((a) => a.playerTag === 'unranked')).toMatchObject({ status: 'excluded', tier: null, mirrorChance: null });
  });

  it('applies a force-in or force-out to that one war only', () => {
    const plan = planSeason({
      warSize: 1,
      accounts: [acc('a', { starsSoFar: 8 }), acc('b', { banned: true, starsSoFar: 8 }), acc('c', { starsSoFar: 8 })],
      rounds: [
        { roundNumber: 1, enemyLineup: null, forceIn: new Set(['b']) },
        { roundNumber: 2, enemyLineup: null, forceOut: new Set(['a']) },
        { roundNumber: 3, enemyLineup: null },
      ],
      futureOpponents: [],
    });
    expect(plan.rounds[0].lineup[0]).toMatchObject({ playerTag: 'b', reason: 'forced_in' });
    expect(plan.rounds[1].lineup[0].playerTag).toBe('c');
    expect(plan.rounds[1].unavailable).toContainEqual(expect.objectContaining({ playerTag: 'a', reason: 'forced_out' }));
    expect(plan.rounds[2].lineup[0].playerTag).not.toBe('b');
  });

  it('respects season-level unavailable rounds', () => {
    const plan = planSeason({
      warSize: 1,
      accounts: [acc('a', { unavailableRounds: new Set([1]) }), acc('b', { starsSoFar: 8 })],
      rounds: rounds(4),
      futureOpponents: [],
    });
    expect(plan.rounds[0].lineup[0].playerTag).toBe('b');
    expect(plan.accounts.find((a) => a.playerTag === 'a')!.plannedRounds).toEqual([2, 3, 4]);
  });

  it('lays the lineup out in mirror order and scores unrevealed rounds against the remaining opponents', () => {
    const plan = planSeason({
      warSize: 2,
      accounts: [acc('low', { thLevel: 15, leagueTier: 31 }), acc('high', { thLevel: 17, leagueTier: 33 })],
      rounds: rounds(1),
      futureOpponents: [[17, 15, 10], [18, 16]],
    });
    const [first, second] = plan.rounds[0].lineup;
    expect(plan.rounds[0].enemyKnown).toBe(false);
    expect(first).toMatchObject({ playerTag: 'high', mapPosition: 1, enemyTh: null });
    // #1 bases of the two remaining opponents: TH17 and TH18; #2 bases: TH15 and TH16.
    expect(first.expectedStars).toBeCloseTo((expectedStars(cwl(17, 17, 33)) + expectedStars(cwl(17, 18, 33))) / 2);
    expect(first.tripleChance).toBeCloseTo((tripleChance(cwl(17, 17, 33)) + tripleChance(cwl(17, 18, 33))) / 2);
    expect(second.expectedStars).toBeCloseTo((expectedStars(cwl(15, 15, 31)) + expectedStars(cwl(15, 16, 31))) / 2);
  });

  it('caps a war that has more forced-in accounts than slots', () => {
    const plan = planSeason({
      warSize: 1,
      accounts: [acc('a'), acc('b')],
      rounds: [{ roundNumber: 1, enemyLineup: null, forceIn: new Set(['a', 'b']) }],
      futureOpponents: [],
    });
    expect(plan.rounds[0].overForced).toBe(true);
    expect(plan.rounds[0].lineup).toHaveLength(1);
  });

  it('counts pending stars from a war already at battle day', () => {
    const plan = planSeason({
      warSize: 1,
      accounts: [acc('a', { starsSoFar: 3, pendingExpected: 3 }), acc('b', { starsSoFar: 8 })],
      rounds: rounds(1),
      futureOpponents: [],
    });
    expect(plan.rounds[0].lineup[0].playerTag).toBe('a');
    expect(plan.accounts.find((x) => x.playerTag === 'a')!.status).toBe('on_track');
  });

  it('plans an account with an unknown league, unlike an unranked one, and rates it below one with a record', () => {
    const plan = planSeason({
      warSize: 2,
      accounts: [acc('ghost', { leagueTier: null, untracked: true }), acc('unranked', { leagueTier: null }), acc('ok')],
      rounds: rounds(1),
      futureOpponents: [],
    });
    expect(tagsOf(plan.rounds[0].lineup)).toEqual(['ghost', 'ok']);
    // Unknown league = a typical family account's, minus the newcomer discount for having no record.
    const ghost = plan.accounts.find((a) => a.playerTag === 'ghost')!;
    expect(ghost.skill!).toBeCloseTo(attackerSkill(16, null));
    expect(ghost.skill!).toBeLessThan(attackerSkill(16, null, { ...UNRATED, attacks: 50 }));
    expect(plan.accounts.find((a) => a.playerTag === 'ghost')).toMatchObject({ untracked: true, excludedReason: null });
  });

  it('keeps an in-game opt-out out of that war unless a leader forces them in', () => {
    const plan = planSeason({
      warSize: 1,
      accounts: [acc('a'), acc('b', { starsSoFar: 8 }), acc('c', { starsSoFar: 8 })],
      rounds: [
        { roundNumber: 1, enemyLineup: null, preferenceOut: new Set(['a', 'c']), forceIn: new Set(['c']) },
        { roundNumber: 2, enemyLineup: null },
      ],
      futureOpponents: [],
    });
    expect(plan.rounds[0].lineup[0]).toMatchObject({ playerTag: 'c', reason: 'forced_in' });
    expect(plan.rounds[0].unavailable).toContainEqual(expect.objectContaining({ playerTag: 'a', reason: 'war_preference' }));
    expect(plan.rounds[1].unavailable.some((u) => u.playerTag === 'a')).toBe(false);
  });

  it('orders a town hall by observed war order, with never-placed accounts last', () => {
    const plan = planSeason({
      warSize: 3,
      accounts: [
        acc('new', { warOrder: null, leagueTier: 36 }),
        acc('low', { warOrder: -0.5 }),
        acc('high', { warOrder: 0.8, leagueTier: 30 }),
      ],
      rounds: rounds(1),
      futureOpponents: [],
    });
    expect(plan.rounds[0].lineup.map((s) => s.playerTag)).toEqual(['high', 'low', 'new']);
    expect(plan.accounts.map((a) => a.playerTag)).toEqual(['high', 'low', 'new']);
  });

  it('fields the account whose war record is better when the league is the same', () => {
    const plan = planSeason({
      warSize: 1,
      accounts: [
        acc('cold', { starsSoFar: 8, rating: { ...UNRATED, mean: -0.6, variance: 0.05, attacks: 40 } }),
        acc('hot', { starsSoFar: 8, rating: { ...UNRATED, mean: 0.6, variance: 0.05, attacks: 40 } }),
      ],
      rounds: [{ roundNumber: 1, enemyLineup: [17] }],
      futureOpponents: [],
    });
    expect(plan.rounds[0].lineup[0].playerTag).toBe('hot');
    const [hot, cold] = ['hot', 'cold'].map((t) => plan.accounts.find((a) => a.playerTag === t)!);
    expect(hot.mirrorChance!).toBeGreaterThan(cold.mirrorChance!);
    expect(hot.skill! - cold.skill!).toBeCloseTo(1.2);
    expect(hot.rating).toEqual({ mean: 0.6, attacks: 40 });
  });

  it('reports no rating for an account without war history', () => {
    const plan = planSeason({ warSize: 1, accounts: [acc('new')], rounds: rounds(1), futureOpponents: [] });
    expect(plan.accounts[0]).toMatchObject({ rating: null, tier: expect.any(String) });
    expect(plan.accounts[0].leagueShare).toBeGreaterThan(0);
  });
});
