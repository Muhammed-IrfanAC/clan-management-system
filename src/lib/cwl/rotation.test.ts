import { describe, it, expect } from 'vitest';
import { suggestClanRotation, roundsPlayedByPerson, TOTAL_ROUNDS } from './rotation';
import type { CWLLeague, CWLRound, CWLWarMember } from '@/types/database';
import type { RotationPlayer } from './rotation';

// Minimal factories — only the fields the engine reads.
function player(id: string, over: Partial<RotationPlayer> = {}): RotationPlayer {
  return { personId: id, name: id.toUpperCase(), thLevel: 15, league: null as CWLLeague | null, playedSoFar: 0, ...over };
}
function round(id: string, clan_id: string, round_number: number): CWLRound {
  return {
    id, season_id: 's', clan_id, round_number, war_tag: '#w', state: 'warEnded',
    team_size: 15, opponent_name: 'Foe', opponent_tag: '#F', our_stars: 0,
    our_destruction: 0, our_attacks_used: 0, start_time: null, end_time: null, polled_at: 'now',
  };
}
function member(round_id: string, person_id: string | null, over: Partial<CWLWarMember> = {}): CWLWarMember {
  return {
    id: `${round_id}-${person_id ?? over.player_tag}`, round_id, person_id, player_tag: '#P',
    name: null, th_level: 15, map_position: 1, attacks_used: 1, stars: 3, destruction: 100, ...over,
  };
}

describe('suggestClanRotation', () => {
  it('rotates the bench fairly so play counts stay even (roster 4, war 3, 7 rounds)', () => {
    const roster = [player('a'), player('b'), player('c'), player('d')];
    const rot = suggestClanRotation('clan', roster, 3);
    expect(rot.noBenchNeeded).toBe(false);
    expect(rot.rounds).toHaveLength(TOTAL_ROUNDS);
    // Each round benches exactly one (roster 4 - war 3).
    for (const r of rot.rounds) {
      expect(r.playing).toHaveLength(3);
      expect(r.bench).toHaveLength(1);
    }
    // Over 7 rounds, 7 bench-slots across 4 players -> nobody sits more than twice or fewer than once.
    const bench = new Map(rot.summary.map((s) => [s.personId, s.benchRounds]));
    for (const b of bench.values()) {
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(2);
    }
    // Projected totals differ by at most one — the fairness guarantee.
    const totals = rot.summary.map((s) => s.projectedTotal);
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
  });

  it('lets the under-played catch up first using playedSoFar', () => {
    // Ann has already played 2 rounds, the rest none. With war size 2 over the remaining rounds Ann
    // should sit until the others have caught up.
    const roster = [
      player('ann', { playedSoFar: 2 }),
      player('bob', { playedSoFar: 0 }),
      player('cal', { playedSoFar: 0 }),
    ];
    const rot = suggestClanRotation('clan', roster, 2, [1, 2]); // rounds 1&2 already locked -> 5 remain
    expect(rot.remainingRoundNumbers).toEqual([3, 4, 5, 6, 7]);
    // Round 3: Bob & Cal (0 played) go in, Ann (2 played) benches.
    expect(rot.rounds[0].bench.map((s) => s.personId)).toEqual(['ann']);
    expect(rot.rounds[0].playing.map((s) => s.personId).sort()).toEqual(['bob', 'cal']);
    // By season end the three land within one war day of each other despite Ann's head start.
    const totals = rot.summary.map((s) => s.projectedTotal);
    expect(Math.max(...totals) - Math.min(...totals)).toBeLessThanOrEqual(1);
  });

  it('breaks equal-rest ties in favour of the stronger player', () => {
    // Two players, both rested, one war slot -> the higher TH plays, the weaker benches.
    const roster = [player('weak', { thLevel: 13 }), player('strong', { thLevel: 16 })];
    const rot = suggestClanRotation('clan', roster, 1, [], 1); // single round
    expect(rot.rounds[0].playing.map((s) => s.personId)).toEqual(['strong']);
    expect(rot.rounds[0].bench.map((s) => s.personId)).toEqual(['weak']);
  });

  it('flags noBenchNeeded when the roster fits the war size', () => {
    const roster = [player('a'), player('b')];
    const rot = suggestClanRotation('clan', roster, 15);
    expect(rot.noBenchNeeded).toBe(true);
    // Everyone plays every remaining round; nobody benches.
    for (const r of rot.rounds) expect(r.bench).toHaveLength(0);
    for (const s of rot.summary) expect(s.benchRounds).toBe(0);
  });

  it('skips locked rounds and only plans the remainder', () => {
    const roster = [player('a'), player('b'), player('c')];
    const rot = suggestClanRotation('clan', roster, 2, [1, 2, 3, 4, 5]);
    expect(rot.remainingRoundNumbers).toEqual([6, 7]);
    expect(rot.rounds).toHaveLength(2);
  });
});

describe('roundsPlayedByPerson', () => {
  it('counts distinct rounds a person was fielded in, scoped to the clan', () => {
    const rounds = [round('r1', 'A', 1), round('r2', 'A', 2), round('r3', 'B', 1)];
    const members = [
      member('r1', 'p1'),
      member('r2', 'p1'),
      member('r3', 'p1'), // different clan -> not counted for A
      member('r1', 'p2'),
      member('r1', null, { player_tag: '#guest' }), // unlinked -> ignored
    ];
    const played = roundsPlayedByPerson(rounds, members, 'A');
    expect(played.get('p1')).toBe(2);
    expect(played.get('p2')).toBe(1);
    expect(played.has('#guest')).toBe(false);
  });

  it('does not double-count a person appearing twice in one round', () => {
    const rounds = [round('r1', 'A', 1)];
    const members = [member('r1', 'p1'), member('r1', 'p1', { id: 'dup' })];
    expect(roundsPlayedByPerson(rounds, members, 'A').get('p1')).toBe(1);
  });
});
