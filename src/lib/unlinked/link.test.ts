import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createClanOpsDb, FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));

import { LinkError, linkUnlinkedAccount } from './link';

beforeEach(() => {
  h.db = createClanOpsDb();
  h.db.seed('persons', [{ id: 'p1', display_name: 'Bob' }]);
  h.db.seed('player_accounts', [
    { player_tag: '#2PP', person_id: 'p1', in_game_name: 'Bob' },
    { player_tag: '#8QQ', person_id: null, in_game_name: 'Fresh' },
  ]);
});

describe('linkUnlinkedAccount', () => {
  it('links as an alt of the person behind another account', async () => {
    expect(await linkUnlinkedAccount({ tag: '8qq', altOfTag: ' #2pp ', newPersonName: 'ignored' }))
      .toEqual({ personId: 'p1', personName: 'Bob', created: false });
    expect(h.db.find('player_accounts', '#8QQ')!.person_id).toBe('p1');
    expect(h.db.rows('persons')).toHaveLength(1);
  });

  it('creates a new person when no alt-of tag is given', async () => {
    const r = await linkUnlinkedAccount({ tag: '#8QQ', newPersonName: 'Fresh Face' });
    expect(r).toMatchObject({ personName: 'Fresh Face', created: true });
    expect(h.db.find('player_accounts', '#8QQ')!.person_id).toBe(r.personId);
  });

  it('never re-points an account that is already linked', async () => {
    await expect(linkUnlinkedAccount({ tag: '#2PP', newPersonName: 'X' })).rejects.toThrow(/already linked/);
    expect(h.db.rows('persons')).toHaveLength(1);
  });

  it('refuses an alt-of account with nobody behind it', async () => {
    h.db.seed('player_accounts', [{ player_tag: '#9YY', person_id: null }]);
    await expect(linkUnlinkedAccount({ tag: '#8QQ', altOfTag: '#9YY' })).rejects.toThrow(LinkError);
  });

  it('needs one of the two', async () => {
    await expect(linkUnlinkedAccount({ tag: '#8QQ' })).rejects.toThrow(/Give either/);
  });
});
