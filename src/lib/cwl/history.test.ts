import { describe, it, expect } from 'vitest';
import { computeCareerStats } from './history';
import type { CWLSeason, CWLRound, CWLWarMember } from '@/types/database';

// Minimal factories — only the fields the roll-up reads.
function season(id: string, label: string, created_at: string): CWLSeason {
  return { id, label, status: 'completed', constraints: { default: { minThLevel: null, minLeague: null, maxBench: null }, perClan: {} }, last_polled_at: null, created_at };
}
function round(id: string, season_id: string, state: string): CWLRound {
  return {
    id, season_id, clan_id: 'c', round_number: 1, war_tag: '#w', state,
    team_size: 15, opponent_name: 'Foe', opponent_tag: '#F', our_stars: 0,
    our_destruction: 0, our_attacks_used: 0, start_time: null, end_time: null, polled_at: 'now',
  };
}
function member(round_id: string, over: Partial<CWLWarMember>): CWLWarMember {
  return {
    id: `${round_id}-${over.player_tag ?? '#P'}`, round_id, person_id: null, player_tag: '#P',
    name: null, th_level: 15, map_position: 1, attacks_used: 0, stars: 0, destruction: 0, ...over,
  };
}

describe('computeCareerStats', () => {
  it('sums a career across seasons and computes attendance', () => {
    const seasons = [season('s1', 'Jan', '2026-01-01'), season('s2', 'Feb', '2026-02-01')];
    const rounds = [round('s1r1', 's1', 'warEnded'), round('s2r1', 's2', 'warEnded')];
    const members = [
      member('s1r1', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 3, destruction: 100 }),
      member('s2r1', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 2, destruction: 80 }),
      // Bob only plays s1 -> attendance 1/2.
      member('s1r1', { person_id: 'p2', player_tag: '#B', name: 'Bob', attacks_used: 1, stars: 1, destruction: 50 }),
    ];
    const { perPerson, totalSeasonsWithData } = computeCareerStats(seasons, rounds, members);
    expect(totalSeasonsWithData).toBe(2);
    const ann = perPerson.find((p) => p.personId === 'p1')!;
    expect(ann.seasonsPlayed).toBe(2);
    expect(ann.attendanceRate).toBeCloseTo(1);
    expect(ann.attacksUsed).toBe(2);
    expect(ann.totalStars).toBe(5);
    expect(ann.avgDestruction).toBeCloseTo(90);
    expect(ann.missed).toBe(0);
    const bob = perPerson.find((p) => p.personId === 'p2')!;
    expect(bob.seasonsPlayed).toBe(1);
    expect(bob.attendanceRate).toBeCloseTo(0.5);
  });

  it('counts seasonsMissedIn as distinct seasons and gates on warEnded', () => {
    const seasons = [season('s1', 'Jan', '2026-01-01'), season('s2', 'Feb', '2026-02-01'), season('s3', 'Mar', '2026-03-01')];
    const rounds = [
      round('s1r1', 's1', 'warEnded'), round('s1r2', 's1', 'warEnded'),
      round('s2r1', 's2', 'warEnded'),
      round('s3r1', 's3', 'inWar'), // live round -> not yet a miss
    ];
    const members = [
      // Two misses in s1 -> still ONE missed season.
      member('s1r1', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 0 }),
      member('s1r2', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 0 }),
      // One miss in s2.
      member('s2r1', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 0 }),
      // s3 is live -> no miss counted.
      member('s3r1', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 0 }),
    ];
    const { perPerson } = computeCareerStats(seasons, rounds, members);
    const ann = perPerson.find((p) => p.personId === 'p1')!;
    expect(ann.missed).toBe(3);          // 2 in s1 + 1 in s2, s3 excluded
    expect(ann.seasonsMissedIn).toBe(2); // distinct seasons
    expect(ann.missedRate).toBeCloseTo(1); // 3 missed / 3 expected (attacksUsed 0)
  });

  it('flags only repeat missers (missed in >= 2 seasons)', () => {
    const seasons = [season('s1', 'Jan', '2026-01-01'), season('s2', 'Feb', '2026-02-01')];
    const rounds = [round('s1r1', 's1', 'warEnded'), round('s2r1', 's2', 'warEnded')];
    const members = [
      // Repeat: misses both seasons.
      member('s1r1', { person_id: 'rep', player_tag: '#R', name: 'Rep', attacks_used: 0 }),
      member('s2r1', { person_id: 'rep', player_tag: '#R', name: 'Rep', attacks_used: 0 }),
      // One-off: misses only s1.
      member('s1r1', { person_id: 'one', player_tag: '#O', name: 'One', attacks_used: 0 }),
      member('s2r1', { person_id: 'one', player_tag: '#O', name: 'One', attacks_used: 1, stars: 2, destruction: 70 }),
    ];
    const { repeatMissers } = computeCareerStats(seasons, rounds, members);
    expect(repeatMissers.map((p) => p.personId)).toEqual(['rep']);
  });

  it('builds a season trend ordered by created_at with stars-per-attack and participants', () => {
    // Deliberately pass seasons out of chronological order to prove sorting.
    const seasons = [season('s2', 'Feb', '2026-02-01'), season('s1', 'Jan', '2026-01-01')];
    const rounds = [round('s1r1', 's1', 'warEnded'), round('s2r1', 's2', 'warEnded')];
    const members = [
      member('s1r1', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 3, destruction: 100 }),
      member('s1r1', { person_id: 'p2', player_tag: '#B', name: 'Bob', attacks_used: 1, stars: 1, destruction: 40 }),
      member('s2r1', { person_id: 'p1', player_tag: '#A', name: 'Ann', attacks_used: 1, stars: 2, destruction: 80 }),
    ];
    const { trend } = computeCareerStats(seasons, rounds, members);
    expect(trend.map((t) => t.label)).toEqual(['Jan', 'Feb']); // oldest -> newest
    expect(trend[0].starsPerAttack).toBeCloseTo(2);  // (3+1)/2
    expect(trend[0].participants).toBe(2);
    expect(trend[1].starsPerAttack).toBeCloseTo(2);  // 2/1
    expect(trend[1].participants).toBe(1);
  });

  it('groups unlinked guest tags separately and excludes empty seasons from data count', () => {
    const seasons = [season('s1', 'Jan', '2026-01-01'), season('s2', 'Feb', '2026-02-01')];
    // Only s1 produced round data.
    const rounds = [round('s1r1', 's1', 'warEnded')];
    const members = [
      member('s1r1', { person_id: null, player_tag: '#guest', name: 'Guest', attacks_used: 0 }),
    ];
    const { perPerson, totalSeasonsWithData, trend } = computeCareerStats(seasons, rounds, members);
    expect(totalSeasonsWithData).toBe(1);
    expect(trend).toHaveLength(1);
    const guest = perPerson.find((p) => p.playerTag === '#guest')!;
    expect(guest.personId).toBeNull();
    expect(guest.missed).toBe(1);
    expect(guest.attendanceRate).toBeCloseTo(1); // played the only season with data
  });
});
