import { describe, it, expect } from 'vitest';
import { planSeason, type PlannerAccount, type PlannerRound } from './planner';

// TH16 tiers: 32+ strong, 30–31 medium, 29- weak.
const STRONG = 32;
const WEAK = 28;

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
        { roundNumber: 1, enemyLineup: [18] }, // +2: weak expects 1.92 — not enough
        { roundNumber: 2, enemyLineup: [14] }, // hitting down: always a triple, 3★
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
    expect(plan.accounts.find((a) => a.playerTag === 'unranked')).toMatchObject({ status: 'excluded', strength: null });
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
    // TH17 strong vs #1 bases TH17 (3.0) and TH18 (+1 → 0.95 → 2.94).
    expect(first.expectedStars).toBeCloseTo((3 + 2.94) / 2);
    // TH15 strong vs #2 bases TH15 (3.0) and TH16 (+1 → 2.94).
    expect(second.expectedStars).toBeCloseTo((3 + 2.94) / 2);
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

  it('rates an account with an unknown league medium and plans it, unlike an unranked one', () => {
    const plan = planSeason({
      warSize: 2,
      accounts: [acc('ghost', { leagueTier: null, untracked: true }), acc('unranked', { leagueTier: null }), acc('ok')],
      rounds: rounds(1),
      futureOpponents: [],
    });
    expect(tagsOf(plan.rounds[0].lineup)).toEqual(['ghost', 'ok']);
    expect(plan.rounds[0].lineup.find((s) => s.playerTag === 'ghost')!.strength).toBe('medium');
    expect(plan.accounts.find((a) => a.playerTag === 'ghost')).toMatchObject({ untracked: true, excludedReason: null });
  });
});
