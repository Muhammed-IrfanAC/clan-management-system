import { describe, it, expect } from 'vitest';
import {
  buildKickList,
  matchKickedArrivals,
  normalizeTag,
  recentDepartures,
  type KickRow,
  type WatchAccount,
  type WatchPerson,
} from './watch';

const NOW = new Date('2026-10-05T12:00:00Z');
const HOUR = 60 * 60 * 1000;

function kick(tag: string, over: Partial<KickRow> = {}): KickRow {
  return {
    player_tag: tag,
    kicked_from_clan_id: 'clan-main',
    comment: null,
    kicked_by: '#LEAD',
    kicked_at: '2026-10-01T10:00:00.000Z',
    updated_at: null,
    ...over,
  };
}

function acct(tag: string, over: Partial<WatchAccount> = {}): WatchAccount {
  return {
    player_tag: tag,
    person_id: null,
    in_game_name: `name-${tag}`,
    th_level: 15,
    status: 'left',
    clan_id: 'clan-main',
    last_synced_at: NOW.toISOString(),
    ...over,
  };
}

function byTag(...accounts: WatchAccount[]) {
  return new Map(accounts.map((a) => [a.player_tag, a]));
}

function persons(...ps: WatchPerson[]) {
  return new Map(ps.map((p) => [p.id, p]));
}

const BOB: WatchPerson = { id: 'p-bob', display_name: 'Bob', access_role: null };
const COLEAD: WatchPerson = { id: 'p-co', display_name: 'Co', access_role: 'co_leader' };

describe('normalizeTag', () => {
  it('uppercases and adds the #', () => {
    expect(normalizeTag('2gy8uvqcv')).toBe('#2GY8UVQCV');
    expect(normalizeTag(' #puqy9jgrp ')).toBe('#PUQY9JGRP');
  });

  it('reads a letter O as zero, the usual typing slip', () => {
    expect(normalizeTag('#PYLO')).toBe('#PYL0');
  });

  it('rejects anything that cannot be a tag', () => {
    expect(normalizeTag('')).toBeNull();
    expect(normalizeTag('#HELLO')).toBeNull(); // H and E never appear in tags
    expect(normalizeTag('#22')).toBeNull();
  });
});

describe('matchKickedArrivals', () => {
  it('matches a kicked account that joins a clan', () => {
    const k = kick('#B1');
    const out = matchKickedArrivals([{ tag: '#B1', clanId: 'clan-feed' }], [k], byTag(acct('#B1')), persons());
    expect(out).toEqual([{ tag: '#B1', clanId: 'clan-feed', kick: k, viaAlt: false }]);
  });

  it('matches another account of the same person, using their newest kick', () => {
    const older = kick('#B1', { kicked_at: '2026-09-01T00:00:00.000Z' });
    const newer = kick('#B2', { kicked_at: '2026-10-01T00:00:00.000Z' });
    const accounts = byTag(
      acct('#B1', { person_id: 'p-bob' }),
      acct('#B2', { person_id: 'p-bob' }),
      acct('#B3', { person_id: 'p-bob', status: 'active', clan_id: 'clan-feed' }),
    );
    const out = matchKickedArrivals([{ tag: '#B3', clanId: 'clan-feed' }], [older, newer], accounts, persons(BOB));
    expect(out).toEqual([{ tag: '#B3', clanId: 'clan-feed', kick: newer, viaAlt: true }]);
  });

  it('ignores accounts linked to leadership, kicked or not', () => {
    const accounts = byTag(acct('#C1', { person_id: 'p-co' }), acct('#C2', { person_id: 'p-co' }));
    const out = matchKickedArrivals(
      [{ tag: '#C1', clanId: 'clan-main' }, { tag: '#C2', clanId: 'clan-main' }],
      [kick('#C1')],
      accounts,
      persons(COLEAD),
    );
    expect(out).toEqual([]);
  });

  it('leaves everyone else alone, including unlinked strangers', () => {
    const accounts = byTag(acct('#B1', { person_id: 'p-bob' }), acct('#X'), acct('#Y', { person_id: 'p-other' }));
    const out = matchKickedArrivals(
      [{ tag: '#X', clanId: 'clan-main' }, { tag: '#Y', clanId: 'clan-main' }],
      [kick('#B1')],
      accounts,
      persons(BOB, { id: 'p-other', display_name: 'Other', access_role: null }),
    );
    expect(out).toEqual([]);
  });
});

describe('buildKickList', () => {
  it('lists newest kicks first, with the kicker resolved to a name', () => {
    const out = buildKickList(
      [kick('#OLD', { kicked_at: '2026-09-01T00:00:00.000Z' }), kick('#NEW', { kicked_at: '2026-10-01T00:00:00.000Z', kicked_by: '#UNKNOWN' })],
      byTag(acct('#OLD'), acct('#NEW')),
      persons(),
      new Map([['#LEAD', 'Lead Person']]),
    );
    expect(out.map((e) => e.tag)).toEqual(['#NEW', '#OLD']);
    expect(out[1].kickedByName).toBe('Lead Person');
    expect(out[0].kickedByName).toBe('#UNKNOWN');
  });

  it("lists the person's other accounts as watched, and flags whichever is in a family clan", () => {
    const accounts = byTag(
      acct('#B1', { person_id: 'p-bob', status: 'left' }),
      acct('#B2', { person_id: 'p-bob', status: 'active', clan_id: 'clan-feed', in_game_name: 'Bobby' }),
      acct('#B3', { person_id: 'p-bob', status: 'inactive', clan_id: null, in_game_name: 'Alt' }),
    );
    const [entry] = buildKickList([kick('#B1', { comment: 'toxic' })], accounts, persons(BOB), new Map());
    expect(entry).toMatchObject({ tag: '#B1', personId: 'p-bob', personName: 'Bob', comment: 'toxic' });
    expect(entry.alts.map((a) => a.tag)).toEqual(['#B3', '#B2']); // by name: Alt, Bobby
    expect(entry.present).toEqual([expect.objectContaining({ tag: '#B2', clanId: 'clan-feed', isAlt: true })]);
  });

  it('flags the kicked account itself when it is back', () => {
    const [entry] = buildKickList([kick('#B1')], byTag(acct('#B1', { status: 'active', clan_id: 'clan-feed' })), persons(), new Map());
    expect(entry.present).toEqual([expect.objectContaining({ tag: '#B1', isAlt: false })]);
    expect(entry.alts).toEqual([]);
  });

  it('hides an entry whose account has since been linked to leadership', () => {
    const out = buildKickList([kick('#C1')], byTag(acct('#C1', { person_id: 'p-co' })), persons(COLEAD), new Map());
    expect(out).toEqual([]);
  });
});

describe('recentDepartures', () => {
  const ago = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString();

  it('offers accounts that left in the last two days, newest first', () => {
    const out = recentDepartures(
      [acct('#A', { last_synced_at: ago(40) }), acct('#B', { last_synced_at: ago(2) }), acct('#OLD', { last_synced_at: ago(49) })],
      persons(),
      new Set(),
      NOW,
    );
    expect(out.map((d) => d.tag)).toEqual(['#B', '#A']);
  });

  it('skips accounts already listed, leadership alts, and anyone not actually gone', () => {
    const out = recentDepartures(
      [
        acct('#KICKED'),
        acct('#CO', { person_id: 'p-co' }),
        acct('#HOPPED', { status: 'active' }),
        acct('#BOB', { person_id: 'p-bob' }),
      ],
      persons(COLEAD, BOB),
      new Set(['#KICKED']),
      NOW,
    );
    expect(out).toEqual([expect.objectContaining({ tag: '#BOB', personName: 'Bob' })]);
  });
});
