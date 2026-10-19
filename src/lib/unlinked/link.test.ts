import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClanOpsDb, FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));

import { linkPersonDiscord, linkUnlinkedAccount, loadPersonCandidates } from './link';

const D1 = '111111111111111111';
const D2 = '222222222222222222';

beforeEach(() => {
  h.db = createClanOpsDb();
  h.db.seed('clans', [{ id: 'c1' }]);
  h.db.seed('persons', [
    { id: 'p1', display_name: 'Bob', discord_user_id: null },
    { id: 'p2', display_name: 'Ann', discord_user_id: `<@${D2}>` },
  ]);
  h.db.seed('player_accounts', [
    { player_tag: '#2PP', person_id: 'p1', in_game_name: 'Bob', clan_id: 'c1' },
    { player_tag: '#8QQ', person_id: null, in_game_name: 'Fresh' },
  ]);
});

describe('linkUnlinkedAccount', () => {
  it('links as an alt of an existing person', async () => {
    expect(await linkUnlinkedAccount('8qq', { personId: 'p1' }))
      .toEqual({ tag: '#8QQ', personId: 'p1', personName: 'Bob', created: false, personDiscordId: null });
    expect(h.db.find('player_accounts', '#8QQ')!.person_id).toBe('p1');
  });

  it('reports the person’s Discord when they have one', async () => {
    expect((await linkUnlinkedAccount('#8QQ', { personId: 'p2' })).personDiscordId).toBe(D2);
  });

  it('creates a new person', async () => {
    const r = await linkUnlinkedAccount('#8QQ', { newPersonName: 'Fresh' });
    expect(r).toMatchObject({ personName: 'Fresh', created: true });
    expect(h.db.find('player_accounts', '#8QQ')!.person_id).toBe(r.personId);
  });

  it('never re-points an account that is already linked', async () => {
    await expect(linkUnlinkedAccount('#2PP', { personId: 'p2' })).rejects.toThrow(/already linked to \*\*Bob\*\*/);
    expect(h.db.rows('persons')).toHaveLength(2);
  });

  it('refuses a person that no longer exists', async () => {
    await expect(linkUnlinkedAccount('#8QQ', { personId: 'gone' })).rejects.toThrow(/no longer exists/);
  });
});

describe('linkPersonDiscord', () => {
  it('links a person who has no Discord yet', async () => {
    expect(await linkPersonDiscord('p1', D1)).toEqual({ personName: 'Bob', unchanged: false });
    expect(h.db.rows('persons').find((p) => p.id === 'p1')!.discord_user_id).toBe(D1);
  });

  it('refuses a Discord account another person already has, in any stored form', async () => {
    await expect(linkPersonDiscord('p1', D2)).rejects.toThrow(/already linked to \*\*Ann\*\*/);
  });

  it('never replaces a person’s different Discord', async () => {
    await expect(linkPersonDiscord('p2', D1)).rejects.toThrow(/Change it on the dashboard/);
    expect(await linkPersonDiscord('p2', D2)).toEqual({ personName: 'Ann', unchanged: true });
  });
});

describe('loadPersonCandidates', () => {
  it('gathers each person’s account names and clans', async () => {
    const byId = new Map((await loadPersonCandidates()).map((c) => [c.personId, c]));
    expect(byId.get('p1')).toEqual({ personId: 'p1', displayName: 'Bob', accountNames: ['Bob'], clanIds: ['c1'] });
    expect(byId.get('p2')!.accountNames).toEqual([]);
  });
});
