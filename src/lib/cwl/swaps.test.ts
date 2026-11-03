import { describe, it, expect } from 'vitest';
import { lineupSwaps, type SwapMember } from './swaps';

const p = (tag: string) => ({ playerTag: tag, name: tag.toUpperCase() });
const m = (round_id: string, player_tag: string, map_position: number): SwapMember => ({ round_id, player_tag, name: player_tag.toUpperCase(), map_position });

describe('lineupSwaps', () => {
  it('diffs the plan against the last fielded war, out and in each in map order', () => {
    const swaps = lineupSwaps({
      planned: [p('a'), p('d'), p('e')],
      nextRoundNumber: 3,
      rounds: [{ id: 'r1', round_number: 1 }, { id: 'r2', round_number: 2 }],
      members: [m('r1', 'z', 1), m('r2', 'c', 3), m('r2', 'a', 1), m('r2', 'b', 2)],
    });
    expect(swaps).toMatchObject({ fromRound: 2, fromCurrentPrep: false });
    expect(swaps.out.map((s) => s.playerTag)).toEqual(['b', 'c']);
    expect(swaps.in.map((s) => s.playerTag)).toEqual(['d', 'e']);
  });

  it('diffs against the next war’s own in-game lineup once it is on prep day', () => {
    const swaps = lineupSwaps({
      planned: [p('a'), p('b')],
      nextRoundNumber: 3,
      rounds: [{ id: 'r2', round_number: 2 }, { id: 'r3', round_number: 3 }],
      members: [m('r2', 'x', 1), m('r2', 'y', 2), m('r3', 'a', 1), m('r3', 'c', 2)],
    });
    expect(swaps).toMatchObject({ fromRound: 3, fromCurrentPrep: true });
    expect(swaps.out.map((s) => s.playerTag)).toEqual(['c']);
    expect(swaps.in.map((s) => s.playerTag)).toEqual(['b']);
  });

  it('walks back past a round with no lineup stored', () => {
    const swaps = lineupSwaps({
      planned: [p('a')],
      nextRoundNumber: 4,
      rounds: [{ id: 'r2', round_number: 2 }, { id: 'r3', round_number: 3 }],
      members: [m('r2', 'a', 1)],
    });
    expect(swaps).toMatchObject({ fromRound: 2, out: [], in: [] });
  });

  it('reports nothing to swap from before any lineup exists', () => {
    expect(lineupSwaps({ planned: [p('a')], nextRoundNumber: 1, rounds: [], members: [] })).toEqual({
      fromRound: null, fromCurrentPrep: false, out: [], in: [],
    });
  });

  it('matches tags case-insensitively', () => {
    const swaps = lineupSwaps({
      planned: [{ playerTag: '#ABC', name: 'A' }],
      nextRoundNumber: 2,
      rounds: [{ id: 'r1', round_number: 1 }],
      members: [m('r1', '#abc', 1)],
    });
    expect(swaps.out).toEqual([]);
    expect(swaps.in).toEqual([]);
  });
});
