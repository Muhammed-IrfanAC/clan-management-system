import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClanOpsDb, FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, histories: new Map<string, unknown[]>(), reads: [] as string[], recent: new Map<string, number>() }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));
vi.mock('@/lib/coc-api', () => ({
  fetchLeagueHistory: async (tag: string) => {
    h.reads.push(tag);
    return h.histories.get(tag) ?? [];
  },
}));
vi.mock('@/lib/cwl/familyStrengthLoad', () => ({ recentWarCounts: async () => h.recent, cwlSignupTags: async () => new Set<string>() }));

import { syncLeagueWeeks } from './leagueSync';

// Monday 2 Nov 2026 05:00 UTC reset; results count as out 30 minutes later.
const NOW = new Date('2026-11-04T20:00:00Z');
const week = (start: string, tier: number) => ({ leagueSeasonId: Date.parse(start) / 1000, leagueTierId: 105000000 + tier, leagueTrophies: 800, placement: 5 });
const run = () => syncLeagueWeeks({ deadline: Date.now() + 10_000, now: NOW });

describe('syncLeagueWeeks', () => {
  beforeEach(() => {
    h.db = createClanOpsDb();
    h.histories = new Map();
    h.reads = [];
    h.recent = new Map([['#AWAY', 12]]);
    h.db.seed('clans', [{ id: 'c1' }]);
    h.db.seed('player_accounts', [
      { player_tag: '#NEW', clan_id: 'c1', status: 'active', th_level: 18, league_history_checked_at: null },
      { player_tag: '#DONE', clan_id: 'c1', status: 'active', th_level: 17, league_history_checked_at: '2026-11-03T00:00:00Z' },
      { player_tag: '#STALE', clan_id: 'c1', status: 'active', th_level: 16, league_history_checked_at: '2026-11-01T00:00:00Z' },
      { player_tag: '#AWAY', clan_id: 'c1', status: 'left', th_level: 15, league_history_checked_at: null },
      { player_tag: '#GONE', clan_id: 'c1', status: 'left', th_level: 15, league_history_checked_at: null },
    ]);
  });

  it('backfills accounts never read, re-reads those last read before this week’s results, and skips the rest', async () => {
    h.histories.set('#NEW', [week('2026-10-19T05:00:00Z', 34), week('2026-10-26T05:00:00Z', 34)]);
    const result = await run();
    expect(h.reads.sort()).toEqual(['#AWAY', '#NEW', '#STALE']); // #DONE is current, #GONE is neither active nor warring with us
    expect(result).toMatchObject({ checked: 3, stored: 2, remaining: 0 });
    expect(h.db.rows('ranked_league_weeks').map((r) => [r.player_tag, r.league_tier_id, r.th_level])).toEqual([
      ['#NEW', 105000034, 18], ['#NEW', 105000034, 18], // no war rows: the TH now
    ]);
    expect(h.db.rows('player_accounts').find((r) => r.player_tag === '#NEW')!.league_history_checked_at).toBe(NOW.toISOString());
  });

  it('keeps the first copy of a week when it is read again', async () => {
    h.histories.set('#NEW', [week('2026-10-26T05:00:00Z', 34)]);
    await run();
    h.db.rows('player_accounts').find((r) => r.player_tag === '#NEW')!.league_history_checked_at = null;
    h.histories.set('#NEW', [week('2026-10-26T05:00:00Z', 34)]);
    const again = await run();
    expect(again.stored).toBe(0);
    expect(h.db.rows('ranked_league_weeks')).toHaveLength(1);
  });
});
