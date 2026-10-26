/* eslint-disable @typescript-eslint/no-explicit-any -- the fake guild answers untyped REST calls */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as any, guild: null as any }));

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));
vi.mock('@/lib/discord', async () => ({
  normalizeDiscordId: (await import('@/lib/discord/format')).normalizeDiscordId,
  discordBotRequest: (...args: unknown[]) => h.guild.request(...args),
}));

import { syncTownHallRoles } from './thRoleSync';

const ALICE = '111111111111111111';
const BOB = '222222222222222222';
const LEFT = '333333333333333333';

/** A Discord server as the bot sees it: roles, members, and the REST calls that change them. */
class FakeGuild {
  roles: { id: string; name: string; managed?: boolean }[] = [];
  members = new Map<string, string[]>();
  canList = true;
  private seq = 0;
  request = vi.fn(async (method: string, path: string, body?: any) => {
    if (method === 'GET' && path.endsWith('/roles')) return structuredClone(this.roles);
    if (method === 'POST' && path.endsWith('/roles')) {
      const role = { id: `role${++this.seq}`, name: body.name };
      this.roles.push(role);
      return role;
    }
    if (method === 'GET' && path.includes('/members?')) {
      if (!this.canList) return null;
      return [...this.members].map(([id, roles]) => ({ user: { id }, roles: [...roles] }));
    }
    const m = path.match(/\/members\/(\d+)(?:\/roles\/(\w+))?$/);
    if (m) {
      const roles = this.members.get(m[1]);
      if (!roles) return null;
      if (method === 'GET') return { user: { id: m[1] }, roles: [...roles] };
      if (method === 'PUT') roles.push(m[2]);
      if (method === 'DELETE') this.members.set(m[1], roles.filter((r) => r !== m[2]));
      return {};
    }
    return null;
  });
  roleNamesOf(id: string) {
    return (this.members.get(id) ?? []).map((r) => this.roles.find((x) => x.id === r)?.name ?? r).sort();
  }
}

function seed() {
  h.db = new FakeDb({ primaryKeys: { player_accounts: 'player_tag', discord_th_roles: 'th_level' } });
  h.db.seed('discord_th_role_sync', [{ id: true, completed_at: null, claimed_at: new Date(0).toISOString() }]);
  h.db.seed('persons', [
    { id: 'alice', discord_user_id: ALICE },
    { id: 'bob', discord_user_id: `<@${BOB}>` },
    { id: 'gone', discord_user_id: LEFT },
  ]);
  h.db.seed('player_accounts', [
    { player_tag: '#A1', person_id: 'alice', th_level: 16, status: 'active' },
    { player_tag: '#A2', person_id: 'alice', th_level: 11, status: 'active' },
    { player_tag: '#B1', person_id: 'bob', th_level: 8, status: 'active' },
    { player_tag: '#G1', person_id: 'gone', th_level: 15, status: 'inactive' },
  ]);
  h.guild = new FakeGuild();
  h.guild.members.set(ALICE, ['member']);
  h.guild.members.set(BOB, []);
  h.guild.members.set(LEFT, []);
}

describe('syncTownHallRoles', () => {
  beforeEach(() => {
    vi.stubEnv('DISCORD_GUILD_ID', '999999999999999999');
    vi.stubEnv('DISCORD_BOT_TOKEN', 'token');
    seed();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('creates TH9 up to the top level and assigns every TH a person owns', async () => {
    const res: any = await syncTownHallRoles({ now: new Date('2026-10-26T00:00:00Z') });
    expect(res.created).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    expect(h.guild.roleNamesOf(ALICE)).toEqual(['TH11', 'TH16', 'member']);
    expect(h.guild.roleNamesOf(BOB)).toEqual([]); // TH8: below the cut-off
    expect(h.db.rows('discord_th_roles')).toHaveLength(8);
    expect(res.complete).toBe(true);
  });

  it('runs once a day, then follows an upgrade, a new town hall, and a departure', async () => {
    await syncTownHallRoles({ now: new Date('2026-10-26T00:00:00Z') });
    h.guild.members.get(LEFT)!.push(h.guild.roles.find((r: any) => r.name === 'TH15').id);

    expect(await syncTownHallRoles({ now: new Date('2026-10-26T06:00:00Z') })).toEqual({ skipped: 'not due' });

    h.db.rows('player_accounts').find((a: any) => a.player_tag === '#A1').th_level = 17;
    const res: any = await syncTownHallRoles({ now: new Date('2026-10-27T01:00:00Z') });
    expect(res.created).toEqual([17]);
    expect(h.guild.roleNamesOf(ALICE)).toEqual(['TH11', 'TH17', 'member']);
    expect(h.guild.roleNamesOf(LEFT)).toEqual([]);
    expect(h.guild.roles.filter((r: any) => r.name === 'TH16')).toHaveLength(1);
  });

  it('adopts an existing role by name rather than making a second one', async () => {
    h.guild.roles.push({ id: 'old16', name: 'TH16' });
    await syncTownHallRoles({ now: new Date('2026-10-26T00:00:00Z') });
    expect(h.guild.roles.filter((r: any) => r.name === 'TH16')).toHaveLength(1);
    expect(h.guild.members.get(ALICE)).toContain('old16');
  });

  it('falls back to per-person lookups without the members intent', async () => {
    h.guild.canList = false;
    await syncTownHallRoles({ now: new Date('2026-10-26T00:00:00Z') });
    expect(h.guild.roleNamesOf(ALICE)).toEqual(['TH11', 'TH16', 'member']);
  });

  it('refuses to act on an empty account read', async () => {
    h.db.tables.player_accounts = [];
    await expect(syncTownHallRoles({ now: new Date('2026-10-26T00:00:00Z') })).rejects.toThrow(/refusing/);
    expect(h.guild.request).not.toHaveBeenCalled();
    expect(h.db.rows('discord_th_role_sync')[0].claimed_at).toBe(new Date(0).toISOString());
  });

  it('does nothing while another pass holds the claim', async () => {
    h.db.rows('discord_th_role_sync')[0].claimed_at = '2026-10-25T23:59:00.000Z';
    expect(await syncTownHallRoles({ now: new Date('2026-10-26T00:00:00Z') })).toEqual({ skipped: 'another pass is running' });
  });
});
