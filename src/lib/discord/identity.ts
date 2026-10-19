/**
 * Discord identity lookups: who a person or player account is on Discord. Every lookup resolves
 * through `normalizeDiscordId`, so a mistyped `persons.discord_user_id` reads as "not linked".
 */

import { supabase } from '@/lib/supabase';
import { normalizeDiscordId } from './format';

/**
 * Resolve a person's Discord user id for @-mentioning them in a notification. Returns null when the
 * person has no linked Discord (persons.discord_user_id is NULL) or the id is unknown — callers pass
 * the result straight to `mentionDiscordId`, where null simply means "no ping". Fail-safe: any DB
 * error resolves to null so a notification can still be sent without a mention.
 */
export async function discordUserIdForPerson(personId?: string | null): Promise<string | null> {
  if (!personId) return null;
  const { data } = await supabase
    .from('persons')
    .select('discord_user_id')
    .eq('id', personId)
    .maybeSingle();
  return normalizeDiscordId(data?.discord_user_id);
}

/**
 * Resolve player-account tags to their person's Discord id, POSITIONALLY — same length, same order,
 * null wherever the chain (account → person → discord_user_id) breaks. Null means "name them, don't
 * ping them", which every caller here treats as a normal outcome rather than an error: a guest
 * account with no person, or a member who never linked Discord, still belongs in the message.
 */
export async function discordIdsForAccountTags(tags: string[]): Promise<(string | null)[]> {
  if (tags.length === 0) return [];
  const { data } = await supabase
    .from('player_accounts')
    .select('player_tag, person:persons(discord_user_id)')
    .in('player_tag', tags);

  const byTag = new Map<string, string | null>();
  for (const row of (data as unknown as { player_tag: string; person: { discord_user_id: string | null } | null }[]) || []) {
    byTag.set(row.player_tag, normalizeDiscordId(row.person?.discord_user_id));
  }
  return tags.map((t) => byTag.get(t) ?? null);
}
