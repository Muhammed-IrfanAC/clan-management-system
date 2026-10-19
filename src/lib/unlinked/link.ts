/**
 * Linking from Discord: an UNLINKED account to a person (an alt of somebody, or a new person), and a
 * person to their Discord user. The Discord half of Members → Unlinked Accounts and the person
 * editor; the handlers are `interactions/commands/unlinkedLink.ts` and `/link`.
 *
 * Stricter than the dashboard's `/api/members/link`, on purpose. A Discord alert outlives the moment
 * it described, and by the time somebody acts on it the account may have been linked from the
 * dashboard — re-pointing it from a stale alert would silently move an account (and its strikes and
 * kick-list watch) to a different person. So an account that is already linked is refused, and the
 * final write is conditional on `person_id IS NULL`, so a race with another leader loses cleanly too.
 *
 * The Discord link has the matching guard: a Discord id claimed by another person is refused rather
 * than moved (two persons sharing one id makes the bot resolve that user to nobody, locking them out
 * of `/me`), and a person's existing, different Discord is never replaced from here.
 */

import { supabase } from '@/lib/supabase';
import { normalizeDiscordId } from '@/lib/discord/format';
import { normalizeTag } from '@/lib/kicks/watch';
import type { PersonCandidate } from './match';

export class LinkError extends Error {}

/** The forms a leader may have typed a Discord id in, as `normalizeDiscordId` accepts them. */
const discordForms = (id: string) => [id, `<@${id}>`, `<@!${id}>`];

export type LinkTarget = { personId: string } | { newPersonName: string };

export type AccountForLink = {
  tag: string;
  name: string;
  clanId: string | null;
  person: { id: string; displayName: string } | null;
};

export async function loadAccountForLink(rawTag: string): Promise<AccountForLink | null> {
  const tag = normalizeTag(rawTag);
  if (!tag) return null;
  const { data, error } = await supabase
    .from('player_accounts')
    .select('player_tag, in_game_name, clan_id, person_id')
    .eq('player_tag', tag)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as { player_tag: string; in_game_name: string | null; clan_id: string | null; person_id: string | null };
  let person: AccountForLink['person'] = null;
  if (row.person_id) {
    const { data: p } = await supabase.from('persons').select('id, display_name').eq('id', row.person_id).maybeSingle();
    person = p ? { id: (p as { id: string }).id, displayName: (p as { display_name: string }).display_name } : { id: row.person_id, displayName: 'someone' };
  }
  return { tag: row.player_tag, name: row.in_game_name || row.player_tag, clanId: row.clan_id, person };
}

export async function linkUnlinkedAccount(
  rawTag: string,
  target: LinkTarget,
): Promise<{ tag: string; personId: string; personName: string; created: boolean; personDiscordId: string | null }> {
  const tag = normalizeTag(rawTag);
  if (!tag) throw new LinkError('That is not a valid player tag.');

  const account = await loadAccountForLink(tag);
  if (!account) throw new LinkError(`\`${tag}\` is not a ClanOps account.`);
  if (account.person) throw new LinkError(`\`${tag}\` is already linked to **${account.person.displayName}**.`);

  let person: { id: string; display_name: string; discord_user_id: string | null };
  let created = false;
  if ('personId' in target) {
    const { data, error } = await supabase
      .from('persons')
      .select('id, display_name, discord_user_id')
      .eq('id', target.personId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new LinkError('That person no longer exists. Pick another.');
    person = data as typeof person;
  } else {
    const name = target.newPersonName.trim();
    if (!name) throw new LinkError('A new person needs a name.');
    const { data, error } = await supabase
      .from('persons')
      .insert([{ display_name: name }])
      .select('id, display_name, discord_user_id')
      .single();
    if (error) throw error;
    person = data as typeof person;
    created = true;
  }

  const { data: linked, error: linkError } = await supabase
    .from('player_accounts')
    .update({ person_id: person.id })
    .eq('player_tag', tag)
    .is('person_id', null)
    .select('player_tag');
  if (linkError) throw linkError;
  if (!linked?.length) {
    // Someone linked it in the meantime; do not leave behind the empty person made for it.
    if (created) await supabase.from('persons').delete().eq('id', person.id);
    throw new LinkError(`\`${tag}\` was linked by someone else just now.`);
  }
  return {
    tag,
    personId: person.id,
    personName: person.display_name,
    created,
    personDiscordId: normalizeDiscordId(person.discord_user_id),
  };
}

/** The persons claiming a Discord user — normally zero or one; more is a data error to surface. */
export async function personsForDiscordUser(discordUserId: string): Promise<{ id: string; displayName: string }[]> {
  const { data, error } = await supabase
    .from('persons')
    .select('id, display_name')
    .in('discord_user_id', discordForms(discordUserId));
  if (error) throw error;
  return ((data as { id: string; display_name: string }[]) || []).map((p) => ({ id: p.id, displayName: p.display_name }));
}

/** Set a person's Discord user, refusing to take it from another person or replace a different one. */
export async function linkPersonDiscord(personId: string, discordUserId: string): Promise<{ personName: string; unchanged: boolean }> {
  const id = normalizeDiscordId(discordUserId);
  if (!id) throw new LinkError('That is not a Discord user.');

  const { data, error } = await supabase.from('persons').select('id, display_name, discord_user_id').eq('id', personId).maybeSingle();
  if (error) throw error;
  if (!data) throw new LinkError('That person no longer exists.');
  const person = data as { id: string; display_name: string; discord_user_id: string | null };

  const current = normalizeDiscordId(person.discord_user_id);
  if (current === id) return { personName: person.display_name, unchanged: true };
  if (current) {
    throw new LinkError(`**${person.display_name}** is already linked to <@${current}>. Change it on the dashboard if that is wrong.`);
  }
  const others = (await personsForDiscordUser(id)).filter((p) => p.id !== personId);
  if (others.length) {
    throw new LinkError(`<@${id}> is already linked to **${others[0].displayName}**. A Discord account can belong to one person only.`);
  }

  const { data: updated, error: updateError } = await supabase
    .from('persons')
    .update({ discord_user_id: id })
    .eq('id', personId)
    .is('discord_user_id', null)
    .select('id');
  if (updateError) throw updateError;
  if (!updated?.length) throw new LinkError(`**${person.display_name}** was given a Discord account by someone else just now.`);
  return { personName: person.display_name, unchanged: false };
}

/** Every person with their accounts' names and clans: the input to `suggestPersons`. */
export async function loadPersonCandidates(): Promise<PersonCandidate[]> {
  const [{ data: persons, error: pErr }, { data: accounts, error: aErr }] = await Promise.all([
    supabase.from('persons').select('id, display_name'),
    supabase.from('player_accounts').select('person_id, in_game_name, clan_id').not('person_id', 'is', null),
  ]);
  if (pErr) throw pErr;
  if (aErr) throw aErr;
  const byPerson = new Map<string, PersonCandidate>();
  for (const p of (persons as { id: string; display_name: string }[]) || []) {
    byPerson.set(p.id, { personId: p.id, displayName: p.display_name, accountNames: [], clanIds: [] });
  }
  for (const a of (accounts as { person_id: string; in_game_name: string | null; clan_id: string | null }[]) || []) {
    const c = byPerson.get(a.person_id);
    if (!c) continue;
    if (a.in_game_name) c.accountNames.push(a.in_game_name);
    if (a.clan_id && !c.clanIds.includes(a.clan_id)) c.clanIds.push(a.clan_id);
  }
  return [...byPerson.values()];
}

/** `/link` autocomplete: accounts nobody is linked to yet, by name or tag. */
export async function searchUnlinkedAccounts(query: string): Promise<{ name: string; value: string }[]> {
  const q = query.trim().replace(/[%_,()]/g, '');
  const base = supabase
    .from('player_accounts')
    .select('player_tag, in_game_name, status')
    .is('person_id', null)
    .order('in_game_name')
    .limit(25);
  const { data, error } = q ? await base.or(`in_game_name.ilike.%${q}%,player_tag.ilike.%${q.replace(/^#/, '')}%`) : await base.eq('status', 'active');
  if (error) throw error;
  return ((data as { player_tag: string; in_game_name: string | null; status: string }[]) || []).map((r) => ({
    name: `${r.in_game_name || r.player_tag} (${r.player_tag})${r.status === 'active' ? '' : ` · ${r.status}`}`.slice(0, 100),
    value: r.player_tag,
  }));
}

/**
 * `/link` autocomplete: persons by their name OR any of their accounts' names/tags — a leader thinks
 * "Bob's alt", and Bob's person may be named differently from his accounts. Value = person id.
 */
export async function searchPersons(query: string): Promise<{ name: string; value: string }[]> {
  const q = query.trim().replace(/[%_,()]/g, '');
  if (!q) return [];
  const [{ data: byName, error: nErr }, { data: byAccount, error: aErr }] = await Promise.all([
    supabase.from('persons').select('id, display_name').ilike('display_name', `%${q}%`).limit(25),
    supabase
      .from('player_accounts')
      .select('person_id, in_game_name, player_tag')
      .not('person_id', 'is', null)
      .or(`in_game_name.ilike.%${q}%,player_tag.ilike.%${q.replace(/^#/, '')}%`)
      .limit(25),
  ]);
  if (nErr) throw nErr;
  if (aErr) throw aErr;

  const hints = new Map<string, string>(); // person id → the account that matched
  for (const a of (byAccount as { person_id: string; in_game_name: string | null; player_tag: string }[]) || []) {
    if (!hints.has(a.person_id)) hints.set(a.person_id, a.in_game_name || a.player_tag);
  }
  const names = new Map(((byName as { id: string; display_name: string }[]) || []).map((p) => [p.id, p.display_name]));
  const missing = [...hints.keys()].filter((id) => !names.has(id));
  if (missing.length) {
    const { data, error } = await supabase.from('persons').select('id, display_name').in('id', missing);
    if (error) throw error;
    for (const p of (data as { id: string; display_name: string }[]) || []) names.set(p.id, p.display_name);
  }
  return [...names.entries()]
    .map(([id, name]) => {
      const hint = hints.get(id);
      return { name: (hint && hint !== name ? `${name} · has ${hint}` : name).slice(0, 100), value: id };
    })
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 25);
}
