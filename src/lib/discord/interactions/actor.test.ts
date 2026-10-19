import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClanOpsDb, FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));
vi.mock('@/lib/permissions-server', () => ({ loadCapabilityOverrides: async () => ({}) }));

import { actorCan, isLeadership, resolveActor } from './actor';

const ID = '123456789012345678';

beforeEach(() => {
  h.db = createClanOpsDb();
  h.db.seed('clans', [{ id: 'c1', display_name: 'Alpha' }]);
});

describe('resolveActor', () => {
  it('resolves a pasted-mention discord id to the person, live role and main account', async () => {
    h.db.seed('persons', [{ id: 'p1', display_name: 'Lead', access_role: 'leader', discord_user_id: `<@${ID}>` }]);
    h.db.seed('player_accounts', [
      { player_tag: '#ALT', person_id: 'p1', clan_id: 'c1', is_main_account: false },
      { player_tag: '#MAIN', person_id: 'p1', clan_id: 'c1', is_main_account: true },
    ]);
    const actor = await resolveActor(ID);
    expect(actor).toMatchObject({ personId: 'p1', role: 'leader', actorTag: '#MAIN', ambiguous: false });
    expect(isLeadership(actor)).toBe(true);
    expect(await actorCan(actor, 'leader.manage')).toBe(true);
  });

  it('a linked member without access is not leadership', async () => {
    h.db.seed('persons', [{ id: 'p2', display_name: 'Member', access_role: null, discord_user_id: ID }]);
    const actor = await resolveActor(ID);
    expect(actor.personId).toBe('p2');
    expect(isLeadership(actor)).toBe(false);
    expect(await actorCan(actor, 'leader.manage')).toBe(false);
  });

  it('refuses to pick between two persons claiming one discord id', async () => {
    h.db.seed('persons', [
      { id: 'p1', display_name: 'A', access_role: 'leader', discord_user_id: ID },
      { id: 'p2', display_name: 'B', access_role: null, discord_user_id: `<@!${ID}>` },
    ]);
    const actor = await resolveActor(ID);
    expect(actor).toMatchObject({ ambiguous: true, personId: null, role: null });
    expect(isLeadership(actor)).toBe(false);
  });

  it('an unknown discord user is nobody', async () => {
    expect(await resolveActor(ID)).toMatchObject({ personId: null, role: null, ambiguous: false });
  });
});
