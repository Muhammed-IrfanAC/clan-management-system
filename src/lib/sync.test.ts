/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles patch the query builder dynamically */
/**
 * Roster-sync lifecycle, run against an in-memory database and a scripted CoC API with a fake
 * clock. These exist because of the 2026-09-14 incident: across several syncs that day, every
 * family clan's active roster was rewritten with `person_id = NULL` (and `added_at` reset), which
 * orphaned 121 of 122 persons — the registry then showed almost nobody. The rows were never
 * deleted; the links were. The first describe block reproduces that.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClanOpsDb, FakeDb } from '@/test/fakeSupabase';
import { FakeCoc, member } from '@/test/fakeCoc';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb, coc: null as any, send: null as any, discord: null as any }));

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));
vi.mock('@/lib/coc-api', () => ({ fetchFromCoC: (e: string) => h.coc.fetch(e) }));
// The post-roster steps are each fail-safe and covered elsewhere; stub them so a sync test is
// only about the roster.
vi.mock('@/lib/cwl/live', () => ({ syncCwlLiveState: vi.fn(async () => null) }));
vi.mock('@/lib/cwl/roster', () => ({ detectCompletedTransfers: vi.fn(async () => null) }));
vi.mock('@/lib/war', () => ({ syncWarState: vi.fn(async () => null) }));
vi.mock('@/lib/rules/scan', () => ({ scanRuleViolations: vi.fn(async () => null) }));
vi.mock('@/lib/members/thRoleSync', () => ({ syncTownHallRoles: vi.fn(async () => null) }));
vi.mock('@/lib/warStats/weeklyPost', () => ({ postWeeklyStats: vi.fn(async () => null) }));
// The kick-list alert runs for real; only the Discord transport is replaced, so a test can count and
// read the messages it would have sent.
vi.mock('@/lib/discord', () => ({
  sendDiscordMessage: (...args: unknown[]) => h.send(...args),
  postDiscordMessage: (...args: unknown[]) => h.discord.post(...args),
  discordBotRequest: (...args: unknown[]) => h.discord.request(...args),
  destinationForClan: vi.fn(async () => 'https://discord.test/hook'),
}));

import { syncClan, runFullSync } from './sync';

/** The bot's view of one channel: messages it posted, readable and editable by id. */
class FakeChannel {
  messages = new Map<string, any>();
  post = vi.fn(async (msg: any) => {
    const messageId = `m${this.messages.size + 1}`;
    this.messages.set(messageId, structuredClone(msg));
    return { channelId: 'ch-unlinked', messageId };
  });
  request = vi.fn(async (method: string, path: string, body?: any) => {
    const id = path.split('/').pop()!;
    if (!this.messages.has(id)) return null;
    if (method === 'GET') return structuredClone(this.messages.get(id));
    if (method === 'PATCH') return this.messages.set(id, structuredClone(body)) && {};
    return null;
  });
}

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-09-01T12:00:00Z');
const MAIN = 'clan-main';
const FEEDER = 'clan-feeder';

function advanceDays(n: number) {
  vi.setSystemTime(new Date(Date.now() + n * DAY));
}

function account(tag: string) {
  return h.db.find('player_accounts', tag);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});

  h.db = createClanOpsDb();
  h.coc = new FakeCoc();
  h.send = vi.fn(async () => true);
  h.discord = new FakeChannel();
  h.db.seed('clans', [
    { id: MAIN, clan_tag: '#MAIN', display_name: 'Main', active: true },
    { id: FEEDER, clan_tag: '#FEED', display_name: 'Feeder', active: true },
  ]);
  h.db.seed('settings', [
    { key: 'inactive_cleanup_days', value: '30' },
  ]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Two linked members in MAIN, synced once so the DB mirrors the game. */
async function seedLinkedRoster() {
  h.db.seed('persons', [
    { id: 'p-alice', display_name: 'Alice' },
    { id: 'p-bob', display_name: 'Bob' },
  ]);
  h.coc.setRoster('#MAIN', [member('#A1'), member('#B1')]);
  h.coc.setRoster('#FEED', [member('#F1')]);
  await runFullSync();
  account('#A1')!.person_id = 'p-alice';
  account('#B1')!.person_id = 'p-bob';
}

describe('person links survive sync (2026-09-14 incident)', () => {
  it('keeps person_id and added_at across ordinary syncs', async () => {
    await seedLinkedRoster();
    const addedAt = account('#A1')!.added_at;
    advanceDays(3);
    await runFullSync();
    expect(account('#A1')).toMatchObject({ person_id: 'p-alice', status: 'active', added_at: addedAt });
    expect(account('#A1')!.last_synced_at).toBe(new Date(T0.getTime() + 3 * DAY).toISOString());
  });

  it('does not wipe person links when the existing-account lookup fails', async () => {
    await seedLinkedRoster();
    const addedAt = account('#A1')!.added_at;
    advanceDays(1);

    // The by-tag lookup of existing rows errors (a transient PostgREST/network failure). The
    // incident signature: sync carried on as if every member were brand new.
    h.db.failNext('player_accounts', 'select', 'upstream timeout', (q) => q.filters.some((f) => f.startsWith('player_tag=in')));
    await expect(syncClan(MAIN)).rejects.toThrow();

    expect(account('#A1')).toMatchObject({ person_id: 'p-alice', added_at: addedAt });
    expect(account('#B1')).toMatchObject({ person_id: 'p-bob', added_at: addedAt });
  });

  it('never clears a link even if the lookup silently misses an existing row', async () => {
    await seedLinkedRoster();
    const addedAt = account('#A1')!.added_at;
    advanceDays(1);

    // A lookup that "succeeds" with no rows (e.g. a stale replica / cache): sync must still not be
    // able to overwrite a link it didn't see.
    const realFrom = h.db.from.bind(h.db);
    let hidden = false;
    vi.spyOn(h.db, 'from').mockImplementation((table: string) => {
      const q = realFrom(table);
      if (table !== 'player_accounts' || hidden) return q;
      const realIn = q.in.bind(q);
      (q as any).in = (c: string, vs: unknown[]) => {
        if (c === 'player_tag' && !hidden) {
          hidden = true;
          return realIn(c, []);
        }
        return realIn(c, vs);
      };
      return q;
    });

    await syncClan(MAIN);
    expect(account('#A1')).toMatchObject({ person_id: 'p-alice', added_at: addedAt, status: 'active' });
    expect(account('#B1')).toMatchObject({ person_id: 'p-bob', status: 'active' });
  });

  it('refuses to apply an empty roster over a clan that has active members', async () => {
    await seedLinkedRoster();
    h.coc.setRoster('#MAIN', []);
    await expect(syncClan(MAIN)).rejects.toThrow(/empty roster/i);
    expect(account('#A1')!.status).toBe('active');
    expect(account('#B1')!.status).toBe('active');
  });

  it('a failed CoC fetch changes nothing', async () => {
    await seedLinkedRoster();
    h.coc.fail('#MAIN');
    await expect(syncClan(MAIN)).rejects.toThrow(/503/);
    expect(account('#A1')).toMatchObject({ status: 'active', person_id: 'p-alice' });
  });
});

describe('roster reconciliation', () => {
  it('inserts new members as active and unlinked', async () => {
    h.coc.setRoster('#MAIN', [member('#N1', { role: 'admin', name: 'Newbie' })]);
    const res = await syncClan(MAIN);
    expect(res).toMatchObject({ success: true, count: 1, left: 0 });
    expect(account('#N1')).toMatchObject({
      clan_id: MAIN,
      status: 'active',
      person_id: null,
      db_role: 'elder',
      in_game_name: 'Newbie',
      added_at: T0.toISOString(),
    });
  });

  it('maps in-game roles to db_role', async () => {
    h.coc.setRoster('#MAIN', [
      member('#L', { role: 'leader' }),
      member('#C', { role: 'coLeader' }),
      member('#E', { role: 'admin' }),
      member('#M', { role: 'member' }),
    ]);
    await syncClan(MAIN);
    expect(['#L', '#C', '#E', '#M'].map((t) => account(t)!.db_role)).toEqual(['leader', 'co_leader', 'elder', 'member']);
  });

  it('marks a departed member left without unlinking them', async () => {
    await seedLinkedRoster();
    h.coc.remove('#B1', '#MAIN');
    const res = await syncClan(MAIN);
    expect(res.left).toBe(1);
    expect(account('#B1')).toMatchObject({ status: 'left', person_id: 'p-bob' });
  });

  it('a member who rejoins is reactivated with their link intact', async () => {
    await seedLinkedRoster();
    h.coc.remove('#B1', '#MAIN');
    await syncClan(MAIN);
    advanceDays(5);
    h.coc.setRoster('#MAIN', [member('#A1'), member('#B1')]);
    await syncClan(MAIN);
    expect(account('#B1')).toMatchObject({ status: 'active', person_id: 'p-bob' });
  });

  it('a mover between family clans keeps their link, whatever order the clans sync in', async () => {
    await seedLinkedRoster();
    h.coc.move('#A1', '#MAIN', '#FEED');
    await runFullSync();
    expect(account('#A1')).toMatchObject({ clan_id: FEEDER, status: 'active', person_id: 'p-alice' });

    // Destination first, then source: the source's "left" update must not flip them back.
    h.coc.move('#A1', '#FEED', '#MAIN');
    await syncClan(MAIN);
    await syncClan(FEEDER);
    expect(account('#A1')).toMatchObject({ clan_id: MAIN, status: 'active', person_id: 'p-alice' });
  });
});

describe('inactive marking (fake clock)', () => {
  async function departBob() {
    await seedLinkedRoster();
    h.coc.remove('#B1', '#MAIN');
    await syncClan(MAIN);
  }

  it('keeps a departed account as left inside the window', async () => {
    await departBob();
    advanceDays(29);
    await syncClan(MAIN);
    expect(account('#B1')).toMatchObject({ status: 'left', person_id: 'p-bob' });
  });

  it('marks a departed account inactive once the window has passed, and never deletes it', async () => {
    await departBob();
    advanceDays(31);
    await syncClan(MAIN);
    expect(account('#B1')).toMatchObject({ status: 'inactive', person_id: 'p-bob' });
    expect(h.db.find('persons', 'p-bob')).toBeDefined();
    expect(h.db.log.some((l) => l.table === 'player_accounts' && l.op === 'delete')).toBe(false);
  });

  it('an inactive account that rejoins is reactivated with its link intact', async () => {
    await departBob();
    advanceDays(40);
    await syncClan(MAIN);
    h.coc.setRoster('#MAIN', [member('#A1'), member('#B1')]);
    await syncClan(MAIN);
    expect(account('#B1')).toMatchObject({ status: 'active', person_id: 'p-bob', clan_id: MAIN });
  });

  it('keeps strikes attached to an account that goes inactive', async () => {
    await departBob();
    h.db.seed('strikes', [{ id: 's1', person_id: 'p-bob', player_account_tag: '#B1', issued_at: new Date().toISOString() }]);
    advanceDays(120);
    await syncClan(MAIN);
    expect(account('#B1')!.status).toBe('inactive');
    expect(h.db.find('strikes', 's1')!.player_account_tag).toBe('#B1');
  });

  it('measures the window from last-seen, so a sync gap longer than the window retires a leaver in the same pass', async () => {
    // last_synced_at is "last seen active" and the clock runs from it. If nobody syncs for 31 days,
    // a member who left during the gap is marked left and then inactive by the very same sync.
    await seedLinkedRoster();
    advanceDays(31);
    h.coc.remove('#B1', '#MAIN');
    await syncClan(MAIN);
    expect(account('#B1')!.status).toBe('inactive');
  });

  it('a legacy warning on a departed account no longer holds anything up', async () => {
    // Under the old hard delete, warnings.player_account_tag (NO ACTION) failed the whole batch and
    // kept every stale account alive. Marking is an update, so the FK never comes into it.
    await seedLinkedRoster();
    h.coc.setRoster('#MAIN', [member('#A1')]);
    h.db.seed('warnings', [{ id: 'w1', person_id: 'p-bob', player_account_tag: '#B1' }]);
    h.db.seed('player_accounts', [{ player_tag: '#GONE', clan_id: MAIN, status: 'active', last_synced_at: new Date().toISOString() }]);
    await syncClan(MAIN); // #B1 and #GONE leave
    advanceDays(31);
    await syncClan(MAIN);
    expect(account('#B1')!.status).toBe('inactive');
    expect(account('#GONE')!.status).toBe('inactive');
  });
});

describe('arrivals', () => {
  const tags = (r: { arrivals: { tag: string; clanId: string }[] }) => r.arrivals.map((a) => `${a.tag}@${a.clanId}`).sort();

  it('reports every member of a clan seen for the first time, then nobody once they are settled', async () => {
    h.coc.setRoster('#MAIN', [member('#A1'), member('#B1')]);
    expect(tags(await syncClan(MAIN))).toEqual([`#A1@${MAIN}`, `#B1@${MAIN}`]);
    expect(tags(await syncClan(MAIN))).toEqual([]);
  });

  it('reports a member coming back after leaving', async () => {
    await seedLinkedRoster();
    h.coc.remove('#B1', '#MAIN');
    await syncClan(MAIN);
    h.coc.setRoster('#MAIN', [member('#A1'), member('#B1')]);
    expect(tags(await syncClan(MAIN))).toEqual([`#B1@${MAIN}`]);
  });

  it('reports a mover in the clan they moved to, whichever clan syncs first', async () => {
    await seedLinkedRoster();
    h.coc.move('#A1', '#MAIN', '#FEED');
    expect(tags(await syncClan(FEEDER))).toEqual([`#A1@${FEEDER}`]);
    expect(tags(await syncClan(MAIN))).toEqual([]);
  });
});

describe('kick list alerts', () => {
  function kick(tag: string, over: Record<string, unknown> = {}) {
    h.db.seed('kicked_accounts', [{
      player_tag: tag,
      kicked_from_clan_id: MAIN,
      comment: 'Ignored war calls',
      kicked_by: '#A1',
      kicked_at: new Date().toISOString(),
      updated_at: null,
      ...over,
    }]);
  }
  const sentEmbeds = () => h.send.mock.calls.map((c: any[]) => c[0].embeds[0]);

  it('alerts once when a kicked player turns up in another family clan', async () => {
    await seedLinkedRoster();
    kick('#B1');
    h.coc.remove('#B1', '#MAIN');
    await runFullSync();
    expect(h.send).not.toHaveBeenCalled(); // leaving is not news

    h.coc.setRoster('#FEED', [member('#F1'), member('#B1', { name: 'Bob' })]);
    const res = await runFullSync();
    expect(res.kickList).toEqual({ matched: 1, alerted: 1 });
    expect(sentEmbeds()).toEqual([
      expect.objectContaining({
        title: '⛔ Kicked player joined Feeder',
        fields: [
          expect.objectContaining({ name: 'Kicked', value: expect.stringContaining('from Main by Alice') }),
          expect.objectContaining({ name: 'Reason', value: 'Ignored war calls' }),
        ],
      }),
    ]);

    await runFullSync(); // still there: not a new arrival
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('alerts when an alt of a kicked player joins', async () => {
    await seedLinkedRoster();
    h.db.seed('player_accounts', [{ player_tag: '#B2', person_id: 'p-bob', in_game_name: 'Bobby', status: 'inactive', clan_id: null }]);
    kick('#B1');
    h.coc.setRoster('#FEED', [member('#F1'), member('#B2', { name: 'Bobby' })]);
    await runFullSync();
    expect(sentEmbeds()).toEqual([expect.objectContaining({ title: '⛔ Alt of a kicked player joined Feeder' })]);
  });

  it('does not alert for an account kicked while it is still in the clan', async () => {
    await seedLinkedRoster();
    kick('#B1');
    await runFullSync();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('never alerts for an account linked to leadership', async () => {
    await seedLinkedRoster();
    kick('#B1');
    h.db.find('persons', 'p-bob')!.access_role = 'co_leader';
    h.coc.move('#B1', '#MAIN', '#FEED');
    await runFullSync();
    expect(h.send).not.toHaveBeenCalled();
  });

  it('a failing kick-list read never fails the sync', async () => {
    await seedLinkedRoster();
    h.coc.setRoster('#FEED', [member('#F1'), member('#NEW')]);
    h.db.failNext('kicked_accounts', 'select', 'upstream timeout');
    const res = await runFullSync();
    expect(res).toMatchObject({ success: true, kickList: null });
    expect(account('#NEW')!.status).toBe('active');
  });
});

describe('unlinked join alerts', () => {
  const actions = (id: string) => h.discord.messages.get(id).embeds[0].fields?.[0]?.value ?? '';
  const offered = (id: string) =>
    h.discord.messages.get(id).components.flatMap((r: any) => r.components).flatMap((c: any) => c.options.map((o: any) => o.value));

  it('stamps a joiner who left before being linked, and keeps the alert open for the one who stayed', async () => {
    await seedLinkedRoster();
    h.coc.setRoster('#MAIN', [member('#A1'), member('#B1'), member('#N1'), member('#N2')]);
    const res = await runFullSync();
    expect(res.unlinked).toMatchObject({ matched: 2, alerted: 2, settled: 0 });
    expect(h.db.rows('unlinked_join_alerts').map((r) => [r.message_id, r.player_tag, r.closed_at]))
      .toEqual([['m1', '#N1', null], ['m1', '#N2', null]]);

    h.coc.remove('#N1', '#MAIN');
    expect((await runFullSync()).unlinked).toMatchObject({ settled: 1 });
    expect(actions('m1')).toMatch(/^🚪 `#N1` left <t:\d+:R>, before anyone linked them$/);
    expect(offered('m1')).toEqual(['#N2']);

    await runFullSync(); // nothing new to say: the alert is not edited again
    expect(h.discord.request.mock.calls.filter((c: any[]) => c[0] === 'PATCH')).toHaveLength(1);
  });

  it('says where a joiner moved, and alerts the clan they moved to', async () => {
    await seedLinkedRoster();
    h.coc.setRoster('#MAIN', [member('#A1'), member('#B1'), member('#N1')]);
    await runFullSync();

    h.coc.remove('#N1', '#MAIN');
    h.coc.setRoster('#FEED', [member('#F1'), member('#N1')]);
    await runFullSync();
    expect(actions('m1')).toContain('↪️ `#N1` moved to **Feeder**');
    expect(h.discord.messages.get('m1').components).toEqual([]); // nothing left open
    expect(h.discord.messages.get('m2').embeds[0].title).toBe('🔗 Unlinked player joined Feeder');
  });

  it('stamps a link made on the dashboard', async () => {
    await seedLinkedRoster();
    h.coc.setRoster('#MAIN', [member('#A1'), member('#B1'), member('#N1')]);
    await runFullSync();

    account('#N1')!.person_id = 'p-alice';
    await runFullSync();
    expect(actions('m1')).toBe('🔗 `#N1` was linked to **Alice** outside this alert');
  });

  it('keeps the joiner open while the alert cannot be edited, and retries next sync', async () => {
    await seedLinkedRoster();
    h.coc.setRoster('#MAIN', [member('#A1'), member('#B1'), member('#N1')]);
    await runFullSync();

    h.coc.remove('#N1', '#MAIN');
    h.discord.request.mockResolvedValueOnce(null); // Discord down for the GET
    expect((await runFullSync()).unlinked).toMatchObject({ settled: 0 });
    expect(h.db.rows('unlinked_join_alerts')[0].closed_at).toBeNull();

    expect((await runFullSync()).unlinked).toMatchObject({ settled: 1 });
    expect(actions('m1')).toContain('🚪 `#N1` left');
  });
});

describe('persons', () => {
  it('are never removed by any sync path', async () => {
    await seedLinkedRoster();
    h.coc.setRoster('#MAIN', [member('#X')]); // everyone we know leaves
    for (let d = 0; d < 120; d += 7) {
      advanceDays(7);
      await runFullSync();
    }
    expect(h.db.find('persons', 'p-alice')).toBeDefined();
    expect(h.db.find('persons', 'p-bob')).toBeDefined();
  });
});

describe('sync lease (no overlapping passes)', () => {
  it('skips a pass while another holds the lease, and runs once it is free', async () => {
    h.coc.setRoster('#MAIN', [member('#A1')]);
    h.coc.setRoster('#FEED', [member('#F1')]);
    h.db.seed('sync_lease', [{ id: true, claimed_at: new Date(Date.now() - 30_000).toISOString() }]);

    expect(await runFullSync()).toEqual({ success: true, skipped: 'another sync is running' });
    expect(account('#A1')).toBeUndefined();

    h.db.find('sync_lease', true)!.claimed_at = new Date(0).toISOString();
    expect(await runFullSync()).toMatchObject({ success: true, clansSynced: 2 });
    expect(account('#A1')).toBeDefined();
    // Released for the next pass.
    expect(h.db.find('sync_lease', true)!.claimed_at).toBe(new Date(0).toISOString());
  });

  it('takes over a stale lease left by a pass that was killed', async () => {
    h.coc.setRoster('#MAIN', [member('#A1')]);
    h.coc.setRoster('#FEED', [member('#F1')]);
    h.db.seed('sync_lease', [{ id: true, claimed_at: new Date(Date.now() - 10 * 60_000).toISOString() }]);
    expect(await runFullSync()).toMatchObject({ success: true, clansSynced: 2 });
  });

  it('runs unguarded when the lease row does not exist (migration not applied)', async () => {
    h.coc.setRoster('#MAIN', [member('#A1')]);
    h.coc.setRoster('#FEED', [member('#F1')]);
    expect(await runFullSync()).toMatchObject({ success: true, clansSynced: 2 });
  });
});
