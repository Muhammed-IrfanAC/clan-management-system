/**
 * PURE half of the kick list (no I/O). `kickList.ts` and `arrivals.ts` are the DB halves, the same
 * split `cwl/lineup.ts` / `cwl/lineupNotify.ts` uses.
 *
 * The kick list exists because the CoC API has no kick event: sync only ever sees an account
 * disappear, exactly as it sees a voluntary leave. So a kick is a leader's statement, and this module
 * answers the questions asked of it once it has been made:
 *
 *   - WHO IS WATCHED. The kicked account, and every other account linked to the same person — kicking
 *     someone's main says nothing good about their alt joining the feeder the next day. An account
 *     linked to a person with dashboard access is never watched: co-leaders kick their own alts to
 *     make room, and that is not a ban.
 *   - WHO CAME BACK. Sync reports each ARRIVAL (a member a clan did not have as an active member
 *     before that pass); `matchKickedArrivals` picks out the watched ones.
 *   - WHAT THE PAGE SHOWS. One entry per kicked account, with the alts it puts on watch and which of
 *     them are in a family clan right now.
 */

import type { AccessRole, PlayerStatus } from '@/types/database';

/** How far back the "recent departures" suggestions reach. Long enough to cover a weekend, short
 * enough that members hopping between family clans don't bury the actual kicks. */
export const RECENT_DEPARTURE_DAYS = 2;

export type KickRow = {
  player_tag: string;
  kicked_from_clan_id: string | null;
  comment: string | null;
  kicked_by: string;
  kicked_at: string;
  updated_at: string | null;
};

export type WatchAccount = {
  player_tag: string;
  person_id: string | null;
  in_game_name: string | null;
  th_level: number | null;
  status: PlayerStatus | null;
  clan_id: string | null;
  last_synced_at?: string | null;
};

export type WatchPerson = {
  id: string;
  display_name: string;
  access_role: AccessRole | null;
};

/** A member a clan did not have as an active member before this sync pass. */
export type ClanArrival = { tag: string; clanId: string };

// ─── Tags ────────────────────────────────────────────────────────────────────────────────────────

// Supercell player tags only ever use these 14 characters. A typed letter O is always meant as zero.
const TAG_RE = /^#[0289PYLQGRJCUV]{3,12}$/;

/** Normalise a tag typed by a person (case, missing '#', O for 0). Null when it cannot be a tag. */
export function normalizeTag(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, '').replace(/O/g, '0');
  const tag = cleaned.startsWith('#') ? cleaned : `#${cleaned}`;
  return TAG_RE.test(tag) ? tag : null;
}

// ─── Shared lookups ──────────────────────────────────────────────────────────────────────────────

function isLeadership(personId: string | null | undefined, persons: Map<string, WatchPerson>): boolean {
  return !!personId && !!persons.get(personId)?.access_role;
}

/** Newest kick first. kicked_at is an ISO timestamp, so string order is time order. */
function newestFirst(a: KickRow, b: KickRow): number {
  return a.kicked_at < b.kicked_at ? 1 : a.kicked_at > b.kicked_at ? -1 : 0;
}

// ─── Arrivals ────────────────────────────────────────────────────────────────────────────────────

export type KickedArrival = {
  /** The account that just arrived. */
  tag: string;
  clanId: string;
  /** The kick that put it on watch. */
  kick: KickRow;
  /** True when the arriving account is not the kicked one but another account of the same person. */
  viaAlt: boolean;
};

/**
 * Pick out the arrivals that are on watch. `accounts` must hold every arriving account and every
 * kicked account (by tag); `persons` every person either links to.
 *
 * An arrival matches its own kick first. Failing that, it matches through its person: any other
 * account of theirs on the list — the newest such kick, when there are several, since that is the
 * one leadership most likely remembers.
 */
export function matchKickedArrivals(
  arrivals: ClanArrival[],
  kicks: KickRow[],
  accounts: Map<string, WatchAccount>,
  persons: Map<string, WatchPerson>,
): KickedArrival[] {
  const kickByTag = new Map(kicks.map((k) => [k.player_tag, k]));
  const kicksByPerson = new Map<string, KickRow[]>();
  for (const k of kicks) {
    const personId = accounts.get(k.player_tag)?.person_id;
    if (!personId) continue;
    const list = kicksByPerson.get(personId) ?? [];
    list.push(k);
    kicksByPerson.set(personId, list);
  }

  const out: KickedArrival[] = [];
  for (const arrival of arrivals) {
    const personId = accounts.get(arrival.tag)?.person_id ?? null;
    if (isLeadership(personId, persons)) continue;

    const own = kickByTag.get(arrival.tag);
    if (own) {
      out.push({ tag: arrival.tag, clanId: arrival.clanId, kick: own, viaAlt: false });
      continue;
    }
    const viaPerson = personId ? kicksByPerson.get(personId) : undefined;
    if (viaPerson?.length) {
      out.push({ tag: arrival.tag, clanId: arrival.clanId, kick: [...viaPerson].sort(newestFirst)[0], viaAlt: true });
    }
  }
  return out;
}

// ─── The kick list page ──────────────────────────────────────────────────────────────────────────

export type WatchedAccountView = {
  tag: string;
  name: string;
  thLevel: number | null;
  status: PlayerStatus | null;
  clanId: string | null;
};

export type KickListEntry = {
  tag: string;
  name: string;
  thLevel: number | null;
  status: PlayerStatus | null;
  comment: string | null;
  kickedAt: string;
  kickedBy: string;
  kickedByName: string;
  kickedFromClanId: string | null;
  personId: string | null;
  personName: string | null;
  /** The person's other accounts — on watch because of this kick. */
  alts: WatchedAccountView[];
  /** Watched accounts (this one or an alt) that are in a family clan right now. */
  present: (WatchedAccountView & { isAlt: boolean })[];
};

function view(a: WatchAccount): WatchedAccountView {
  return {
    tag: a.player_tag,
    name: a.in_game_name || a.player_tag,
    thLevel: a.th_level,
    status: a.status,
    clanId: a.clan_id,
  };
}

/**
 * One entry per kick, newest first. Kicks whose account is linked to leadership are left out — the
 * API refuses to list those, but an account can be linked to leadership after the fact.
 *
 * `accounts` must hold every kicked account and every account of the persons they link to.
 */
export function buildKickList(
  kicks: KickRow[],
  accounts: Map<string, WatchAccount>,
  persons: Map<string, WatchPerson>,
  kickerNames: Map<string, string>,
): KickListEntry[] {
  const byPerson = new Map<string, WatchAccount[]>();
  for (const a of accounts.values()) {
    if (!a.person_id) continue;
    const list = byPerson.get(a.person_id) ?? [];
    list.push(a);
    byPerson.set(a.person_id, list);
  }

  const entries: KickListEntry[] = [];
  for (const k of [...kicks].sort(newestFirst)) {
    const account = accounts.get(k.player_tag);
    const personId = account?.person_id ?? null;
    if (isLeadership(personId, persons)) continue;

    const alts = (personId ? byPerson.get(personId) ?? [] : [])
      .filter((a) => a.player_tag !== k.player_tag)
      .map(view)
      .sort((a, b) => a.name.localeCompare(b.name));
    const self = account ? view(account) : null;
    const present = [
      ...(self && self.status === 'active' ? [{ ...self, isAlt: false }] : []),
      ...alts.filter((a) => a.status === 'active').map((a) => ({ ...a, isAlt: true })),
    ];

    entries.push({
      tag: k.player_tag,
      name: account?.in_game_name || k.player_tag,
      thLevel: account?.th_level ?? null,
      status: account?.status ?? null,
      comment: k.comment,
      kickedAt: k.kicked_at,
      kickedBy: k.kicked_by,
      kickedByName: kickerNames.get(k.kicked_by) || k.kicked_by,
      kickedFromClanId: k.kicked_from_clan_id,
      personId,
      personName: personId ? persons.get(personId)?.display_name ?? null : null,
      alts,
      present,
    });
  }
  return entries;
}

// ─── Recent departures ───────────────────────────────────────────────────────────────────────────

export type DepartureEntry = {
  tag: string;
  name: string;
  thLevel: number | null;
  clanId: string | null;
  lastSeenAt: string;
  personName: string | null;
};

/**
 * The accounts worth asking "was that a kick?" about: left a family clan in the last
 * RECENT_DEPARTURE_DAYS, newest first. `left` is the account's status, so a member who hopped to
 * another family clan is already active again and never shows up. Leadership's alts are left out,
 * as are accounts already on the list.
 */
export function recentDepartures(
  departed: WatchAccount[],
  persons: Map<string, WatchPerson>,
  kickedTags: Set<string>,
  now: Date,
): DepartureEntry[] {
  const since = now.getTime() - RECENT_DEPARTURE_DAYS * 24 * 60 * 60 * 1000;
  return departed
    .filter((a) => a.status === 'left' && a.last_synced_at && new Date(a.last_synced_at).getTime() >= since)
    .filter((a) => !kickedTags.has(a.player_tag) && !isLeadership(a.person_id, persons))
    .sort((a, b) => (a.last_synced_at! < b.last_synced_at! ? 1 : -1))
    .map((a) => ({
      tag: a.player_tag,
      name: a.in_game_name || a.player_tag,
      thLevel: a.th_level,
      clanId: a.clan_id,
      lastSeenAt: a.last_synced_at!,
      personName: a.person_id ? persons.get(a.person_id)?.display_name ?? null : null,
    }));
}
