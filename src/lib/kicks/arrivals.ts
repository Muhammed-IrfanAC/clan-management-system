/**
 * The sync step that notices a kicked player coming back: DB/send half of `matchKickedArrivals`.
 *
 * Sync hands over every ARRIVAL of the pass — a member a clan did not have as an active member
 * before it — so each join is seen exactly once and no "already alerted" state is needed: by the
 * next pass the account is active in that clan and is not an arrival any more. Leaving and coming
 * back is a new arrival, and alerts again, which is the point.
 */

import { supabase } from '@/lib/supabase';
import { sendDiscordMessage, webhookUrlForClan } from '@/lib/discord';
import { loadWatchContext, namesForTags } from './kickList';
import { matchKickedArrivals, type ClanArrival, type KickRow } from './watch';
import { renderKickedArrival } from './alertPost';

export async function alertKickedArrivals(arrivals: ClanArrival[]): Promise<{ matched: number; alerted: number }> {
  if (!arrivals.length) return { matched: 0, alerted: 0 };

  const { data, error } = await supabase.from('kicked_accounts').select('*');
  if (error) throw error;
  const kicks = (data as KickRow[]) || [];
  if (!kicks.length) return { matched: 0, alerted: 0 };

  const { accounts, persons } = await loadWatchContext([
    ...new Set([...kicks.map((k) => k.player_tag), ...arrivals.map((a) => a.tag)]),
  ]);
  const matches = matchKickedArrivals(arrivals, kicks, accounts, persons);
  if (!matches.length) return { matched: 0, alerted: 0 };

  const { data: clans, error: clansError } = await supabase.from('clans').select('id, display_name');
  if (clansError) throw clansError;
  const clanName = new Map(((clans as { id: string; display_name: string }[]) || []).map((c) => [c.id, c.display_name]));
  const kickerNames = await namesForTags(matches.map((m) => m.kick.kicked_by));

  let alerted = 0;
  for (const m of matches) {
    const joiner = accounts.get(m.tag);
    const kicked = accounts.get(m.kick.player_tag);
    const personId = joiner?.person_id ?? kicked?.person_id ?? null;
    const message = renderKickedArrival({
      name: joiner?.in_game_name || m.tag,
      tag: m.tag,
      thLevel: joiner?.th_level ?? null,
      clanName: clanName.get(m.clanId) || 'a family clan',
      viaAlt: m.viaAlt,
      personName: personId ? persons.get(personId)?.display_name ?? null : null,
      kickedName: kicked?.in_game_name || m.kick.player_tag,
      kickedTag: m.kick.player_tag,
      kickedFromClanName: m.kick.kicked_from_clan_id ? clanName.get(m.kick.kicked_from_clan_id) ?? null : null,
      kickedAt: m.kick.kicked_at,
      kickedByName: kickerNames.get(m.kick.kicked_by) || m.kick.kicked_by,
      comment: m.kick.comment,
    });
    if (await sendDiscordMessage(message, await webhookUrlForClan(m.clanId, 'leadership'))) alerted++;
  }
  return { matched: matches.length, alerted };
}
