import { describe, it, expect } from 'vitest';
import { computeSeasonPerformance } from './performance';
import type { CWLRound, CWLWarMember } from '@/types/database';

// Minimal round/member factories — only the fields the roll-up reads.
function round(id: string, state: string): CWLRound {
  return {
    id, season_id: 's', clan_id: 'c', round_number: 1, war_tag: '#w', state,
    team_size: 15, opponent_name: 'Foe', opponent_tag: '#F', our_stars: 0,
    our_destruction: 0, our_attacks_used: 0, start_time: null, end_time: null, polled_at: 'now',
  };
}
function member(round_id: string, over: Partial<CWLWarMember>): CWLWarMember {
  return {
    id: `${round_id}-${over.player_tag}`, round_id, person_id: null, player_tag: '#P',
    name: null, th_level: 15, map_position: 1, attacks_used: 0, stars: 0, destruction: 0, ...over,
  };
}

describe('computeSeasonPerformance', () => {
  it('sums stars and averages destruction over attacks used across rounds', () => {
    const rounds = [round('r1', 'warEnded'), round('r2', 'warEnded')];
    const members = [
      member('r1', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 3, destruction: 100 }),
      member('r2', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 2, destruction: 80 }),
    ];
    const { perMember } = computeSeasonPerformance(rounds, members);
    expect(perMember).toHaveLength(1);
    const ann = perMember[0];
    expect(ann.roundsPlayed).toBe(2);
    expect(ann.attacksUsed).toBe(2);
    expect(ann.totalStars).toBe(5);
    expect(ann.avgDestruction).toBeCloseTo(90);
    expect(ann.missed).toBe(0);
  });

  it('counts a missed attack only once the round has ended', () => {
    const rounds = [round('ended', 'warEnded'), round('live', 'inWar')];
    const members = [
      // Same member sits in an ended round (no attack -> missed) and a live round (not yet a miss).
      member('ended', { person_id: 'p2', player_tag: '#B', name: 'Bob', attacks_used: 0 }),
      member('live', { person_id: 'p2', player_tag: '#B', name: 'Bob', attacks_used: 0 }),
    ];
    const { perMember } = computeSeasonPerformance(rounds, members);
    const bob = perMember.find((m) => m.personId === 'p2')!;
    expect(bob.missed).toBe(1);
    expect(bob.roundsPlayed).toBe(2);
    expect(bob.attacksUsed).toBe(0);
    expect(bob.avgDestruction).toBeNull();
  });

  it('groups unlinked tags separately and rolls family totals up', () => {
    const rounds = [round('r1', 'warEnded')];
    const members = [
      member('r1', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 3, destruction: 100 }),
      member('r1', { person_id: null, player_tag: '#guest', name: 'Guest', attacks_used: 0 }),
    ];
    const { perMember, totals } = computeSeasonPerformance(rounds, members);
    expect(perMember).toHaveLength(2);
    // Guest keyed by tag, no person link.
    const guest = perMember.find((m) => m.playerTag === '#guest')!;
    expect(guest.personId).toBeNull();
    expect(guest.missed).toBe(1);
    // Totals across both members.
    expect(totals.totalStars).toBe(3);
    expect(totals.attacksUsed).toBe(1);
    expect(totals.missed).toBe(1);
    expect(totals.avgDestruction).toBeCloseTo(100);
  });

  it('sorts members by total stars descending', () => {
    const rounds = [round('r1', 'warEnded')];
    const members = [
      member('r1', { person_id: 'low', player_tag: '#L', name: 'Low', attacks_used: 1, stars: 1, destruction: 50 }),
      member('r1', { person_id: 'high', player_tag: '#H', name: 'High', attacks_used: 1, stars: 3, destruction: 100 }),
    ];
    const { perMember } = computeSeasonPerformance(rounds, members);
    expect(perMember.map((m) => m.personId)).toEqual(['high', 'low']);
  });
});
