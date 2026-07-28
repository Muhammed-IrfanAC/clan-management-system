import { describe, it, expect } from 'vitest';
import { diffLineup, type PlannedSlot, type ActualSlot } from './lineup';

const planned = (tag: string, isBench = false): PlannedSlot => ({ playerTag: tag, name: tag.slice(1), isBench });
const actual = (tag: string, mapPosition?: number): ActualSlot => ({ playerTag: tag, name: tag.slice(1), mapPosition });

describe('diffLineup', () => {
  it('reports a clean match when the war fielded exactly the planned starters', () => {
    const d = diffLineup([planned('#a'), planned('#b')], [actual('#a', 1), actual('#b', 2)]);
    expect(d.matchesPlan).toBe(true);
    expect(d.swappedIn).toEqual([]);
    expect(d.swappedOut).toEqual([]);
    expect(d.asPlanned).toBe(2);
  });

  it('does not treat a benched account that sat out as swapped out', () => {
    // The bench is a wanted position — sitting is the plan working, not a deviation.
    const d = diffLineup([planned('#a'), planned('#b', true)], [actual('#a')]);
    expect(d.matchesPlan).toBe(true);
    expect(d.swappedOut).toEqual([]);
    expect(d.plannedSize).toBe(1); // bench excluded from the planned lineup size
  });

  it('marks a promoted reserve as swapped in FROM THE BENCH, and the starter they replaced as out', () => {
    const d = diffLineup(
      [planned('#a'), planned('#b'), planned('#c', true)],
      [actual('#a'), actual('#c')],
    );
    expect(d.swappedIn).toEqual([{ playerTag: '#c', name: 'c', reason: 'from_bench' }]);
    expect(d.swappedOut).toEqual([{ playerTag: '#b', name: 'b' }]);
    expect(d.asPlanned).toBe(1);
    expect(d.matchesPlan).toBe(false);
  });

  it('marks an account the season never assigned to this clan as UNPLANNED', () => {
    // Distinct from a bench promotion: the plan has nothing to say about this roster at all.
    const d = diffLineup([planned('#a'), planned('#b')], [actual('#a'), actual('#b'), actual('#zz')]);
    expect(d.swappedIn).toEqual([{ playerTag: '#zz', name: 'zz', reason: 'unplanned' }]);
    expect(d.swappedOut).toEqual([]);
    expect(d.actualSize).toBe(3);
  });

  it('compares tags case-insensitively', () => {
    const d = diffLineup([planned('#ABC')], [actual('#abc')]);
    expect(d.matchesPlan).toBe(true);
  });

  it('handles an empty plan — every body in the war is unplanned', () => {
    const d = diffLineup([], [actual('#a'), actual('#b')]);
    expect(d.swappedIn.map((s) => s.reason)).toEqual(['unplanned', 'unplanned']);
    expect(d.asPlanned).toBe(0);
    expect(d.plannedSize).toBe(0);
  });

  it('handles an unrevealed/empty lineup — every planned starter reads as out', () => {
    const d = diffLineup([planned('#a'), planned('#b', true)], []);
    expect(d.swappedOut).toEqual([{ playerTag: '#a', name: 'a' }]);
    expect(d.swappedIn).toEqual([]);
    expect(d.asPlanned).toBe(0);
  });

  it('preserves the caller-supplied order in both lists', () => {
    const d = diffLineup(
      [planned('#a'), planned('#b'), planned('#c')],
      [actual('#z', 1), actual('#y', 2)],
    );
    expect(d.swappedIn.map((s) => s.playerTag)).toEqual(['#z', '#y']);
    expect(d.swappedOut.map((s) => s.playerTag)).toEqual(['#a', '#b', '#c']);
  });
});
