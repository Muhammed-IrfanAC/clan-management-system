/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles and seeded rows are plain JSON */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({
  db: null as unknown as FakeDb,
  history: new Map<string, any[] | Error>(),
  post: null as any,
}));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));
vi.mock('@/lib/coc-api', () => ({
  fetchLeagueHistory: async (tag: string) => {
    const v = h.history.get(tag);
    if (v instanceof Error) throw v;
    return v ?? null;
  },
  fetchBattleLog: async () => [],
}));
vi.mock('@/lib/discord', () => ({
  postDiscordMessage: (...args: unknown[]) => h.post(...args),
  destinationForClan: async (clanId: string) => ({ channelId: `ch-${clanId}` }),
}));

import { postWeeklyStats } from './weeklyPost';

const WEEK = 1792386000; // Mon 19 Oct 2026 05:00 UTC → Mon 26 Oct 05:00 UTC
const AFTER = new Date('2026-10-26T06:00:00Z');

function entry(p: Record<string, any> = {}) {
  return {
    leagueSeasonId: WEEK, leagueTrophies: 400, leagueTierId: 105000020, placement: 10,
    attackWins: 0, attackLosses: 0, attackStars: 0, defenseWins: 1, defenseLosses: 3, defenseStars: 6, maxBattles: 12,
    ...p,
  };
}

function seedClan(id: string, name: string, tags: string[]) {
  h.db.seed('clans', [{ id, display_name: name, active: true }]);
  h.db.seed(
    'player_accounts',
    tags.map((t) => ({ player_tag: t, clan_id: id, status: 'active', in_game_name: `P${t}`, th_level: 16, league_tier_id: 105000020 })),
  );
}

beforeEach(() => {
  h.db = new FakeDb({ primaryKeys: { player_accounts: 'player_tag' } });
  h.history = new Map();
  let n = 0;
  h.post = vi.fn(async (_msg: any, dest: any) => ({ channelId: dest.channelId, messageId: `m${++n}` }));
  seedClan('main', 'Main', ['#A1', '#A2']);
  seedClan('feeder', 'Feeder', ['#B1']);
  for (const t of ['#A1', '#A2', '#B1']) h.history.set(t, [entry()]);
});

describe('postWeeklyStats', () => {
  it('does nothing outside the posting window', async () => {
    expect(await postWeeklyStats({ now: new Date('2026-10-26T05:10:00Z') })).toBeNull();
    expect(await postWeeklyStats({ now: new Date('2026-10-27T06:00:00Z') })).toBeNull();
    expect(h.post).not.toHaveBeenCalled();
  });

  it('posts each clan once into its own channel and stamps it', async () => {
    const res = await postWeeklyStats({ now: AFTER });
    expect(res).toEqual({ week: WEEK, results: { main: 'sent', feeder: 'sent' } });
    expect(h.post.mock.calls.map((c: any[]) => [c[0].embeds[0].title, c[1].channelId])).toEqual([
      ['📊 Weekly report · Main', 'ch-main'],
      ['📊 Weekly report · Feeder', 'ch-feeder'],
    ]);
    expect(h.post.mock.calls[0][0].embeds[0].fields[0].value).toContain('**Played** 2 of 2');
    expect(h.db.rows('weekly_stats_posts').map((r) => [r.clan_id, r.league_season_id, r.outcome, r.message_id])).toEqual([
      ['main', WEEK, 'sent', 'm1'],
      ['feeder', WEEK, 'sent', 'm2'],
    ]);

    expect(await postWeeklyStats({ now: new Date('2026-10-26T06:05:00Z') })).toEqual({ week: WEEK, results: {} });
    expect(h.post).toHaveBeenCalledTimes(2);
  });

  it('waits for results, then stamps a clan with nothing to report without posting', async () => {
    h.history = new Map([['#A1', []], ['#A2', []], ['#B1', [entry()]]]);
    expect((await postWeeklyStats({ now: AFTER }))!.results).toEqual({ main: 'waiting', feeder: 'sent' });
    expect(h.db.rows('weekly_stats_posts').map((r) => r.clan_id)).toEqual(['feeder']);

    expect((await postWeeklyStats({ now: new Date('2026-10-26T08:30:00Z') }))!.results).toEqual({ main: 'empty' });
    expect(h.post).toHaveBeenCalledTimes(1);
  });

  it('posts the war section alone once the wait for results is over', async () => {
    h.history = new Map([['#A1', []], ['#A2', []], ['#B1', []]]);
    h.db.seed('war_rounds', [{ id: 'w1', clan_id: 'main', state: 'warEnded', end_time: '2026-10-25T12:00:00Z', attacks_per_member: 2 }]);
    h.db.seed('war_attacks', [{
      round_id: 'w1', attack_order: 1, attacker_tag: '#A1', attacker_name: 'A1', attacker_person_id: null,
      attacker_th: 16, defender_tag: '#D1', defender_th: 16, stars: 3, destruction: 100,
    }]);
    const res = await postWeeklyStats({ now: new Date('2026-10-26T09:00:00Z') });
    expect(res!.results).toEqual({ main: 'sent', feeder: 'empty' });
    expect(h.post.mock.calls[0][0].embeds[0].fields.map((f: any) => f.name)[0]).toBe('Clan hit rate');
  });

  it('releases the claim when the send fails, so the next sync retries', async () => {
    h.post.mockResolvedValueOnce(null);
    expect((await postWeeklyStats({ now: AFTER }))!.results).toEqual({ main: 'send_failed', feeder: 'sent' });
    expect(h.db.rows('weekly_stats_posts').map((r) => r.clan_id)).toEqual(['feeder']);
    expect((await postWeeklyStats({ now: AFTER }))!.results).toEqual({ main: 'sent' });
  });

  it("retries a clan whose members' results cannot be read, without holding up the others", async () => {
    h.history.set('#A1', new Error('CoC API error: 503'));
    h.history.set('#A2', new Error('CoC API error: 503'));
    expect((await postWeeklyStats({ now: AFTER }))!.results).toEqual({ main: 'error', feeder: 'sent' });
    expect(h.db.rows('weekly_stats_posts').map((r) => r.clan_id)).toEqual(['feeder']);
  });

  it('notes a member it could not read rather than counting them as idle', async () => {
    seedClan('third', 'Third', ['#C1', '#C2', '#C3']);
    h.history.set('#C1', [entry()]);
    h.history.set('#C2', [entry()]);
    h.history.set('#C3', new Error('timeout'));
    await postWeeklyStats({ now: AFTER });
    const embed = h.post.mock.calls[2][0].embeds[0];
    expect(embed.fields[0].value).toContain('**Played** 2 of 2');
    expect(embed.footer.text).toContain("1 account couldn't be read");
  });

  it('stops starting new clans near the deadline', async () => {
    const res = await postWeeklyStats({ now: AFTER, deadline: Date.now() + 5_000 });
    expect(res!.results).toEqual({});
  });
});
