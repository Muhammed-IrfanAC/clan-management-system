/**
 * Load a member Profile (see profilePost.ts) — by player tag, or by person. Flat selects plus one
 * embed for the clan name, so it runs on fakeSupabase.
 */

import { supabase } from '@/lib/supabase';
import { normalizeDiscordId } from '@/lib/discord/format';
import { normalizeTag } from '@/lib/kicks/watch';
import type { AccessRole, PlayerStatus } from '@/types/database';
import type { Profile, ProfileAccount } from './profilePost';

type AccountRow = {
  player_tag: string;
  in_game_name: string;
  th_level: number | null;
  status: PlayerStatus;
  is_main_account: boolean;
  person_id: string | null;
  clan: { display_name: string } | null;
};

const ACCOUNT_COLUMNS = 'player_tag, in_game_name, th_level, status, is_main_account, person_id, clan:clans(display_name)';

/** Null when the tag is malformed or unknown. */
export async function loadProfileByTag(rawTag: string): Promise<Profile | null> {
  const tag = normalizeTag(rawTag);
  if (!tag) return null;
  const { data } = await supabase.from('player_accounts').select(ACCOUNT_COLUMNS).eq('player_tag', tag).maybeSingle();
  const row = data as unknown as AccountRow | null;
  if (!row) return null;
  if (row.person_id) return loadProfileByPerson(row.person_id);
  return { personName: null, discordUserId: null, accessRole: null, accounts: await withStanding([row]) };
}

export async function loadProfileByPerson(personId: string): Promise<Profile | null> {
  const [{ data: person }, { data: rows }] = await Promise.all([
    supabase.from('persons').select('display_name, discord_user_id, access_role').eq('id', personId).maybeSingle(),
    supabase.from('player_accounts').select(ACCOUNT_COLUMNS).eq('person_id', personId),
  ]);
  if (!person) return null;
  const p = person as { display_name: string; discord_user_id: string | null; access_role: AccessRole | null };
  return {
    personName: p.display_name,
    discordUserId: normalizeDiscordId(p.discord_user_id),
    accessRole: p.access_role ?? null,
    accounts: await withStanding((rows || []) as unknown as AccountRow[]),
  };
}

/** Attach each account's strikes and kick-list flag, in two queries for the whole set. */
async function withStanding(rows: AccountRow[]): Promise<ProfileAccount[]> {
  const tags = rows.map((r) => r.player_tag);
  if (tags.length === 0) return [];
  const [{ data: strikes }, { data: kicked }] = await Promise.all([
    supabase.from('strikes').select('player_account_tag, issued_at, leadership_approved').in('player_account_tag', tags),
    supabase.from('kicked_accounts').select('player_tag').in('player_tag', tags),
  ]);
  const kickedTags = new Set(((kicked || []) as { player_tag: string }[]).map((k) => k.player_tag));
  const strikeRows = (strikes || []) as { player_account_tag: string; issued_at: string; leadership_approved: boolean }[];

  return rows.map((r) => ({
    tag: r.player_tag,
    name: r.in_game_name,
    thLevel: r.th_level ?? null,
    clanName: r.clan?.display_name ?? null,
    status: r.status,
    isMain: r.is_main_account,
    strikes: strikeRows
      .filter((s) => s.player_account_tag === r.player_tag)
      .map((s) => ({ issuedAt: s.issued_at, leadershipApproved: !!s.leadership_approved })),
    kicked: kickedTags.has(r.player_tag),
  }));
}

/** Name/tag suggestions for autocomplete: active accounts first, at most 25 (Discord's cap). */
export async function searchAccounts(query: string): Promise<{ name: string; value: string }[]> {
  const q = query.trim().replace(/[%_,()]/g, '');
  const base = supabase.from('player_accounts').select('player_tag, in_game_name, status').order('in_game_name').limit(25);
  const { data } = q
    ? await base.or(`in_game_name.ilike.%${q}%,player_tag.ilike.%${q.replace(/^#/, '')}%`)
    : await base.eq('status', 'active');
  const rows = (data || []) as { player_tag: string; in_game_name: string; status: PlayerStatus }[];
  return rows
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'))
    .map((r) => ({ name: `${r.in_game_name} (${r.player_tag})${r.status === 'active' ? '' : ' · ' + r.status}`.slice(0, 100), value: r.player_tag }));
}
