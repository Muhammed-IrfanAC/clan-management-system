/**
 * Link an UNLINKED account to a person: an alt of someone already in ClanOps, or a new person. The
 * Discord half of Members → Unlinked Accounts (`/api/members/link` is the dashboard's).
 *
 * Unlike the dashboard route, this refuses an account that is already linked. A Discord alert
 * outlives the moment it described, and by the time somebody acts on it the account may have been
 * linked from the dashboard — re-pointing it from a stale alert would silently move an account (and
 * its strikes and kick-list watch) to a different person. The final write is conditional on
 * `person_id IS NULL`, so a race with another leader loses cleanly too.
 */

import { supabase } from '@/lib/supabase';
import { normalizeTag } from '@/lib/kicks/watch';

export class LinkError extends Error {}

export async function linkUnlinkedAccount(params: {
  tag: string;
  /** Any account of the person to link to, when this is their alt. Wins over `newPersonName`. */
  altOfTag?: string | null;
  newPersonName?: string | null;
}): Promise<{ personId: string; personName: string; created: boolean }> {
  const tag = normalizeTag(params.tag);
  if (!tag) throw new LinkError('That is not a valid player tag.');

  const { data: account, error } = await supabase
    .from('player_accounts')
    .select('player_tag, person_id')
    .eq('player_tag', tag)
    .maybeSingle();
  if (error) throw error;
  if (!account) throw new LinkError(`\`${tag}\` is not a ClanOps account.`);
  if ((account as { person_id: string | null }).person_id) throw new LinkError(`\`${tag}\` is already linked.`);

  let personId: string;
  let personName: string;
  let created = false;
  if (params.altOfTag?.trim()) {
    const altOf = normalizeTag(params.altOfTag);
    if (!altOf) throw new LinkError(`\`${params.altOfTag.trim()}\` is not a valid player tag.`);
    if (altOf === tag) throw new LinkError('An account cannot be an alt of itself.');
    const { data: other, error: otherError } = await supabase
      .from('player_accounts')
      .select('person_id')
      .eq('player_tag', altOf)
      .maybeSingle();
    if (otherError) throw otherError;
    const otherPerson = (other as { person_id: string | null } | null)?.person_id;
    if (!otherPerson) throw new LinkError(`\`${altOf}\` is not linked to anyone, so there is no person to add an alt to.`);
    const { data: person, error: personError } = await supabase
      .from('persons')
      .select('id, display_name')
      .eq('id', otherPerson)
      .single();
    if (personError) throw personError;
    personId = (person as { id: string }).id;
    personName = (person as { display_name: string }).display_name;
  } else {
    const name = params.newPersonName?.trim();
    if (!name) throw new LinkError('Give either an account they already have linked, or a name for a new person.');
    const { data: person, error: personError } = await supabase
      .from('persons')
      .insert([{ display_name: name }])
      .select('id, display_name')
      .single();
    if (personError) throw personError;
    personId = (person as { id: string }).id;
    personName = (person as { display_name: string }).display_name;
    created = true;
  }

  const { data: linked, error: linkError } = await supabase
    .from('player_accounts')
    .update({ person_id: personId })
    .eq('player_tag', tag)
    .is('person_id', null)
    .select('player_tag');
  if (linkError) throw linkError;
  if (!linked?.length) {
    // Someone linked it in the meantime; do not leave behind the empty person made for it.
    if (created) await supabase.from('persons').delete().eq('id', personId);
    throw new LinkError(`\`${tag}\` was linked by someone else just now.`);
  }
  return { personId, personName, created };
}
