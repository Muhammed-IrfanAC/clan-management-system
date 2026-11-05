import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClanOpsDb, FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, logs: new Map<string, unknown[] | Error>(), reads: [] as string[] }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));
vi.mock('@/lib/coc-api', () => ({
  fetchBattleLog: async (tag: string) => {
    h.reads.push(tag);
    const log = h.logs.get(tag);
    if (log instanceof Error) throw log;
    return log ?? null;
  },
}));

import { REFRESH_AFTER_MS, syncRankedAttacks } from './attackSync';

const NOW = new Date('2026-11-04T20:00:00Z');
const attack = (opp: string, ts = '20261103T120000.000Z') => ({
  battleType: 'ranked', attack: true, opponentPlayerTag: opp, opponentName: opp, opponentTownHallLevel: 17,
  stars: 2, destructionPercentage: 80, battleTime: 100, battleTimestamp: ts,
});
const run = () => syncRankedAttacks({ deadline: Date.now() + 10_000, now: NOW });

describe('syncRankedAttacks', () => {
  beforeEach(() => {
    h.db = createClanOpsDb();
    h.logs = new Map();
    h.reads = [];
    h.db.seed('clans', [{ id: 'c1' }]);
    h.db.seed('player_accounts', [
      { player_tag: '#DUE', clan_id: 'c1', status: 'active', th_level: 16, league_tier_id: 105000031, battle_log_checked_at: null },
      { player_tag: '#FRESH', clan_id: 'c1', status: 'active', th_level: 17, league_tier_id: 105000032, battle_log_checked_at: new Date(NOW.getTime() - 60_000).toISOString() },
      { player_tag: '#GONE', clan_id: 'c1', status: 'left', th_level: 15, league_tier_id: 105000030, battle_log_checked_at: null },
    ]);
  });

  it('reads only active accounts that are due, stores their Ranked attacks and stamps them', async () => {
    h.logs.set('#DUE', [attack('#X'), attack('#Y'), { ...attack('#D'), attack: false }]);
    const result = await run();
    expect(h.reads).toEqual(['#DUE']);
    expect(result).toEqual({ checked: 1, stored: 2, remaining: 0 });
    expect(h.db.rows('ranked_attacks').map((r) => [r.player_tag, r.opponent_tag, r.attacker_th])).toEqual([['#DUE', '#X', 16], ['#DUE', '#Y', 16]]);
    expect(h.db.rows('player_accounts').find((r) => r.player_tag === '#DUE')!.battle_log_checked_at).toBe(NOW.toISOString());
  });

  it('adds only attacks it has not seen when a log is read again', async () => {
    h.logs.set('#DUE', [attack('#X')]);
    await run();
    h.db.rows('player_accounts').find((r) => r.player_tag === '#DUE')!.battle_log_checked_at = new Date(NOW.getTime() - REFRESH_AFTER_MS - 1).toISOString();
    h.logs.set('#DUE', [attack('#X'), attack('#Z', '20261104T100000.000Z')]);
    const again = await run();
    expect(again.stored).toBe(1);
    expect(h.db.rows('ranked_attacks')).toHaveLength(2);
  });

  it('leaves an account due when its log cannot be read', async () => {
    h.logs.set('#DUE', new Error('CoC API 503'));
    const result = await run();
    expect(result).toEqual({ checked: 0, stored: 0, remaining: 1 });
    expect(h.db.rows('player_accounts').find((r) => r.player_tag === '#DUE')!.battle_log_checked_at).toBeNull();
  });
});
