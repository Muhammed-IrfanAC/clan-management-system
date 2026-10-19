/**
 * Who is acting, for an interaction: the bot's equivalent of `authorizeActive`.
 *
 * Discord vouches for the user id (the request is signature-verified). Everything after that comes
 * from OUR database — Discord user → `persons.discord_user_id` → that person's LIVE `access_role` —
 * exactly as a dashboard request resolves through the cookie's tag. Discord roles are never
 * consulted: they would be a second, drifting source of truth, the same trap as `db_role`.
 *
 * `persons.discord_user_id` is free text a leader typed, so the lookup matches the forms
 * `normalizeDiscordId` accepts. Two persons claiming one Discord id is a data error, and the actor
 * resolves to nobody rather than to whichever row came back first.
 */

import { supabase } from '@/lib/supabase';
import { can, type Capability } from '@/lib/permissions';
import { loadCapabilityOverrides } from '@/lib/permissions-server';
import type { AccessRole } from '@/types/database';

export type Actor = {
  discordUserId: string;
  personId: string | null;
  displayName: string | null;
  /** Live dashboard role; null = no dashboard access (or not linked at all). */
  role: AccessRole | null;
  /** The person's main account tag, for attribution (`logged_by`); null when unlinked. */
  actorTag: string | null;
  /** More than one person claims this Discord id — fix the data before trusting it. */
  ambiguous: boolean;
};

export async function resolveActor(discordUserId: string): Promise<Actor> {
  const none: Actor = { discordUserId, personId: null, displayName: null, role: null, actorTag: null, ambiguous: false };

  const { data: persons, error } = await supabase
    .from('persons')
    .select('id, display_name, access_role')
    .in('discord_user_id', [discordUserId, `<@${discordUserId}>`, `<@!${discordUserId}>`]);
  if (error) {
    console.error('Discord actor lookup failed:', error);
    return none;
  }
  if (!persons || persons.length === 0) return none;
  if (persons.length > 1) return { ...none, ambiguous: true };

  const person = persons[0] as { id: string; display_name: string; access_role: AccessRole | null };
  const { data: accounts } = await supabase
    .from('player_accounts')
    .select('player_tag, is_main_account')
    .eq('person_id', person.id);
  const list = (accounts || []) as { player_tag: string; is_main_account: boolean }[];
  const main = list.find((a) => a.is_main_account) ?? list[0];

  return {
    discordUserId,
    personId: person.id,
    displayName: person.display_name,
    role: person.access_role ?? null,
    actorTag: main?.player_tag ?? null,
    ambiguous: false,
  };
}

/** Has dashboard access at all — the bar every leadership command clears first. */
export function isLeadership(actor: Actor): boolean {
  return !actor.ambiguous && !!actor.role;
}

/** Capability check against the live role and the runtime overrides, as `requireCapability` does. */
export async function actorCan(actor: Actor, cap: Capability): Promise<boolean> {
  if (!isLeadership(actor)) return false;
  return can(actor.role, cap, await loadCapabilityOverrides());
}
