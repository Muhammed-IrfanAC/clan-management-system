import { describe, it, expect, vi, beforeEach } from 'vitest';

const group = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../coc-api', () => ({
  UNREVEALED_WAR_TAG: '#0',
  fetchLeagueGroup: vi.fn(async () => group.value),
  fetchLeagueWar: vi.fn(async () => {
    throw new Error('tests pass their own fetchWar');
  }),
}));

import { pollLeagueState, type KnownRound } from './api';

const war = (tag: string) => ({ state: 'inWar', teamSize: 15, clan: { tag: '#US' }, opponent: { tag: tag + 'OPP' } });

beforeEach(() => {
  group.value = {
    clans: [],
    rounds: [
      { warTags: ['#R1A', '#R1B', '#R1C', '#R1D'] },
      { warTags: ['#R2A', '#R2B', '#R2C', '#R2D'] },
      { warTags: ['#R3A', '#R3B', '#R3C', '#R3D'] },
      { warTags: ['#0', '#0', '#0', '#0'] },
    ],
  };
});

describe('pollLeagueState', () => {
  it('fetches every revealed war when nothing is known yet', async () => {
    const fetchWar = vi.fn(async (t: string) => war(t) as never);
    const snap = await pollLeagueState('#US', { fetchWar });
    expect(fetchWar).toHaveBeenCalledTimes(12);
    expect(snap!.settledRounds).toEqual([]);
  });

  it('skips an ended round and fetches only our war for a known live one', async () => {
    const known = new Map<number, KnownRound>([
      [1, { warTag: '#R1C', ended: true }],
      [2, { warTag: '#R2B', ended: false }],
    ]);
    const fetchWar = vi.fn(async (t: string) => war(t) as never);
    const snap = await pollLeagueState('#US', { known, fetchWar });
    expect(fetchWar.mock.calls.map((c) => c[0]).sort()).toEqual(['#R2B', '#R3A', '#R3B', '#R3C', '#R3D']);
    expect(snap!.settledRounds).toEqual([1]);
  });

  it('falls back to fetching the round when the known tag is no longer listed', async () => {
    const known = new Map<number, KnownRound>([[1, { warTag: '#STALE', ended: true }]]);
    const fetchWar = vi.fn(async (t: string) => war(t) as never);
    const snap = await pollLeagueState('#US', { known, fetchWar });
    expect(fetchWar).toHaveBeenCalledTimes(12);
    expect(snap!.settledRounds).toEqual([]);
  });

  it('returns null off-season', async () => {
    group.value = null;
    expect(await pollLeagueState('#US')).toBeNull();
  });
});
