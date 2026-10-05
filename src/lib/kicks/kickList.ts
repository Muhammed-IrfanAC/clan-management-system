/**
 * DB half of the kick list: reads for the page, and the three leader actions (list, comment,
 * remove). The decisions themselves live in the pure `watch.ts`; the sync-time alert is `arrivals.ts`.
 *
 * Every read is a flat select rather than a PostgREST embed so the same code runs against the
 * in-memory test database.
 */

import { supabase } from '@/lib/supabase';
import { fetchFromCoCOptional, type CoCPlayer } from '@/lib/coc-api';
import {
  buildKickList,
  normalizeTag,
  recentDepartures,
  RECENT_DEPARTURE_DAYS,
  type DepartureEntry,
  type KickListEntry,
  type KickRow,
  type WatchAccount,
  type WatchPerson,
} from './watch';

/** A refusal the API turns into its HTTP status, like AuthError. */
export class KickListError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const ACCOUNT_COLS = 'player_tag, person_id, in_game_name, th_level, status, clan_id, last_synced_at';

async function personsById(ids: string[]): Promise<Map<string, WatchPerson>> {
  const out = new Map<string, WatchPerson>();
  if (!ids.length) return out;
  const { data, error } = await supabase.from('persons').select('id, display_name, access_role').in('id', ids);
  if (error) throw error;
  for (const p of (data as WatchPerson[]) || []) out.set(p.id, p);
  return out;
}

/**
 * The watch's view of the world for some accounts: the accounts themselves, the persons they link
 * to, and every other account of those persons (the alts a kick puts on watch).
 */
export async function loadWatchContext(tags: string[]) {
  const accounts = new Map<string, WatchAccount>();
  if (!tags.length) return { accounts, persons: new Map<string, WatchPerson>() };

  const { data: direct, error } = await supabase.from('player_accounts').select(ACCOUNT_COLS).in('player_tag', tags);
  if (error) throw error;
  for (const a of (direct as WatchAccount[]) || []) accounts.set(a.player_tag, a);

  const personIds = [...new Set([...accounts.values()].map((a) => a.person_id).filter((id): id is string => !!id))];
  if (personIds.length) {
    const { data: alts, error: altsError } = await supabase.from('player_accounts').select(ACCOUNT_COLS).in('person_id', personIds);
    if (altsError) throw altsError;
    for (const a of (alts as WatchAccount[]) || []) accounts.set(a.player_tag, a);
  }
  return { accounts, persons: await personsById(personIds) };
}

/** Display names for the leaders who made kicks: their person's name, else the account's. */
export async function namesForTags(tags: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(tags)];
  if (!unique.length) return out;
  const { data, error } = await supabase.from('player_accounts').select('player_tag, in_game_name, person_id').in('player_tag', unique);
  if (error) throw error;
  const rows = (data as { player_tag: string; in_game_name: string | null; person_id: string | null }[]) || [];
  const persons = await personsById([...new Set(rows.map((r) => r.person_id).filter((id): id is string => !!id))]);
  for (const r of rows) {
    out.set(r.player_tag, (r.person_id && persons.get(r.person_id)?.display_name) || r.in_game_name || r.player_tag);
  }
  return out;
}

/** The kick list, newest first — or just the entries for `onlyTags`, to return one after a write. */
export async function loadKickList(onlyTags?: string[]): Promise<KickListEntry[]> {
  let query = supabase.from('kicked_accounts').select('*');
  if (onlyTags) query = query.in('player_tag', onlyTags);
  const { data, error } = await query;
  if (error) throw error;
  const kicks = (data as KickRow[]) || [];

  const { accounts, persons } = await loadWatchContext(kicks.map((k) => k.player_tag));
  const kickerNames = await namesForTags(kicks.map((k) => k.kicked_by));
  return buildKickList(kicks, accounts, persons, kickerNames);
}

/** Accounts that left a family clan in the last few days and might have been kicked. */
export async function loadRecentDepartures(now = new Date()): Promise<DepartureEntry[]> {
  const since = new Date(now.getTime() - RECENT_DEPARTURE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('player_accounts')
    .select(ACCOUNT_COLS)
    .eq('status', 'left')
    .gte('last_synced_at', since);
  if (error) throw error;
  const departed = (data as WatchAccount[]) || [];
  if (!departed.length) return [];

  const tags = departed.map((a) => a.player_tag);
  const { data: kicked, error: kickedError } = await supabase.from('kicked_accounts').select('player_tag').in('player_tag', tags);
  if (kickedError) throw kickedError;
  const persons = await personsById([...new Set(departed.map((a) => a.person_id).filter((id): id is string => !!id))]);
  return recentDepartures(departed, persons, new Set(((kicked as { player_tag: string }[]) || []).map((k) => k.player_tag)), now);
}

/**
 * Put an account on the kick list. The tag may be one sync has never seen (kicked before ClanOps
 * existed, say): the account row is then created from the CoC API as 'inactive' with no clan, so the
 * list can reference it — and if the player joins a family clan, sync's upsert takes that row over
 * and reports them as an arrival.
 */
export async function markKicked(params: { rawTag: string; comment?: string | null; actorTag: string }): Promise<KickListEntry> {
  const tag = normalizeTag(params.rawTag ?? '');
  if (!tag) throw new KickListError('That is not a valid player tag', 400);

  const readAccount = async () => {
    const { data, error } = await supabase.from('player_accounts').select(ACCOUNT_COLS).eq('player_tag', tag).maybeSingle();
    if (error) throw error;
    return data as WatchAccount | null;
  };

  let account = await readAccount();
  if (!account) {
    let player: CoCPlayer | null;
    try {
      player = await fetchFromCoCOptional<CoCPlayer>(`/players/${encodeURIComponent(tag)}`);
    } catch {
      throw new KickListError('Could not reach the Clash of Clans API to look that tag up — try again shortly', 502);
    }
    if (!player) throw new KickListError(`No Clash of Clans account has the tag ${tag}`, 404);

    // ignoreDuplicates: if sync created the row in the meantime, its version wins.
    const { error } = await supabase
      .from('player_accounts')
      .upsert([{ player_tag: tag, in_game_name: player.name, th_level: player.townHallLevel, status: 'inactive', clan_id: null }], {
        onConflict: 'player_tag',
        ignoreDuplicates: true,
      });
    if (error) throw error;
    account = await readAccount();
    if (!account) throw new Error(`Account ${tag} vanished while being added`);
  }

  const name = account.in_game_name || tag;
  if (account.person_id) {
    const person = (await personsById([account.person_id])).get(account.person_id);
    if (person?.access_role) {
      throw new KickListError(
        `${name} belongs to ${person.display_name}, who has dashboard access — leadership accounts are never put on the kick list`,
        409,
      );
    }
  }

  const { data: existing, error: existingError } = await supabase.from('kicked_accounts').select('player_tag').eq('player_tag', tag).maybeSingle();
  if (existingError) throw existingError;
  if (existing) throw new KickListError(`${name} is already on the kick list`, 409);

  const { error: insertError } = await supabase.from('kicked_accounts').insert({
    player_tag: tag,
    kicked_from_clan_id: account.clan_id ?? null,
    comment: params.comment?.trim() || null,
    kicked_by: params.actorTag,
  });
  if (insertError) {
    if (insertError.code === '23505') throw new KickListError(`${name} is already on the kick list`, 409);
    throw insertError;
  }

  const [entry] = await loadKickList([tag]);
  return entry;
}

export async function updateKickComment(rawTag: string, comment: string | null): Promise<KickListEntry> {
  const tag = normalizeTag(rawTag);
  if (!tag) throw new KickListError('That is not a valid player tag', 400);
  const { data, error } = await supabase
    .from('kicked_accounts')
    .update({ comment: comment?.trim() || null, updated_at: new Date().toISOString() })
    .eq('player_tag', tag)
    .select('player_tag');
  if (error) throw error;
  if (!data?.length) throw new KickListError('That account is not on the kick list', 404);
  const [entry] = await loadKickList([tag]);
  return entry;
}

export async function removeKick(rawTag: string): Promise<void> {
  const tag = normalizeTag(rawTag);
  if (!tag) throw new KickListError('That is not a valid player tag', 400);
  const { data, error } = await supabase.from('kicked_accounts').delete().eq('player_tag', tag).select('player_tag');
  if (error) throw error;
  if (!data?.length) throw new KickListError('That account is not on the kick list', 404);
}

/** Is this account on the kick list? Used to refuse permanently deleting a listed account. */
export async function isKicked(tag: string): Promise<boolean> {
  const { data, error } = await supabase.from('kicked_accounts').select('player_tag').eq('player_tag', tag).maybeSingle();
  if (error) throw error;
  return !!data;
}
