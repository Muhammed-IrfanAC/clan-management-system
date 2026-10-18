/**
 * The sync step that tells leadership an unlinked player joined: DB/send half of `joinPost.ts`.
 *
 * Fed the same per-pass ARRIVALS as the kick-list watch, so each join is posted exactly once with no
 * "already alerted" state. Runs after every clan is reconciled, reading the accounts fresh, so an
 * account sync just created (person_id NULL) is seen as the unlinked account it is.
 */

import { supabase } from '@/lib/supabase';
import { sendDiscordMessage, webhookUrlForClan } from '@/lib/discord';
import type { ClanArrival } from '@/lib/kicks/watch';
import { renderUnlinkedJoins, selectUnlinkedJoins, type UnlinkedAccount } from './joinPost';

export async function alertUnlinkedArrivals(arrivals: ClanArrival[]): Promise<{ matched: number; alerted: number }> {
  if (!arrivals.length) return { matched: 0, alerted: 0 };
  const tags = [...new Set(arrivals.map((a) => a.tag))];

  const { data, error } = await supabase
    .from('player_accounts')
    .select('player_tag, person_id, in_game_name, th_level')
    .in('player_tag', tags);
  if (error) throw error;
  const accounts = new Map(((data as UnlinkedAccount[]) || []).map((a) => [a.player_tag, a]));

  const { data: kicked, error: kickedError } = await supabase
    .from('kicked_accounts')
    .select('player_tag')
    .in('player_tag', tags);
  if (kickedError) throw kickedError;
  const kickedTags = new Set(((kicked as { player_tag: string }[]) || []).map((k) => k.player_tag));

  const byClan = selectUnlinkedJoins(arrivals, accounts, kickedTags);
  if (!byClan.size) return { matched: 0, alerted: 0 };

  const { data: clans, error: clansError } = await supabase.from('clans').select('id, display_name');
  if (clansError) throw clansError;
  const clanName = new Map(((clans as { id: string; display_name: string }[]) || []).map((c) => [c.id, c.display_name]));

  let matched = 0;
  let alerted = 0;
  for (const [clanId, joiners] of byClan) {
    matched += joiners.length;
    const message = renderUnlinkedJoins(clanName.get(clanId) || 'a family clan', joiners);
    if (await sendDiscordMessage(message, await webhookUrlForClan(clanId, 'unlinked'))) alerted += joiners.length;
  }
  return { matched, alerted };
}
