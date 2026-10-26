/**
 * The daily town-hall role pass: DB/Discord half of `thRoles.ts`.
 *
 * Runs as a step of `runFullSync` but does real work at most once a day (`discord_th_role_sync`,
 * migration 041): a finished pass stamps `completed_at`, and every sync until a day later returns
 * straight away. A pass that runs out of its time budget — the first one, assigning a whole family's
 * roles one request at a time against Discord's rate limits — does NOT stamp it, so the next sync
 * picks up where it stopped. The plan is recomputed from the live server each time, so a resumed
 * pass never repeats a change that already landed.
 *
 * Needs DISCORD_BOT_TOKEN and DISCORD_GUILD_ID (and Manage Roles, which the family's bot holds as
 * administrator). Without either it is a no-op.
 *
 * Reading the member list uses Discord's "List Guild Members", which requires the Server Members
 * privileged intent to be switched on in the Developer Portal. Without it, the pass falls back to
 * looking up each linked person individually — slower, and it can only clean up roles on members
 * the registry still links, so enabling the intent is what makes removals complete.
 */

import { supabase } from '@/lib/supabase';
import { discordBotRequest, normalizeDiscordId } from '@/lib/discord';
import {
  desiredLevels,
  isDue,
  planRoleChanges,
  resolveRoles,
  roleLevels,
  thRoleName,
  type GuildMember,
  type GuildRole,
  type RoleAccount,
} from './thRoles';

/** Wall-clock the pass may spend before stopping and leaving the rest to the next sync. */
const BUDGET_MS = 25_000;
/** A claim older than this belongs to a pass that died (function timeout) — take it over. */
const CLAIM_STALE_MS = 10 * 60 * 1000;
/** Concurrent member lookups on the fallback path, well inside Discord's global 50 req/s. */
const LOOKUP_CONCURRENCY = 5;

export type ThRoleSyncResult =
  | { skipped: string }
  | { created: number[]; adopted: number[]; added: number; removed: number; failed: number; members: number; complete: boolean };

type RawMember = { user?: { id?: string; bot?: boolean }; roles?: string[] };

/**
 * `deadline` (epoch ms) caps the pass below its own budget when the caller has already spent time —
 * the sync passes its overall deadline so this last step cannot push the function past its limit.
 */
export async function syncTownHallRoles(opts: { now?: Date; force?: boolean; deadline?: number } = {}): Promise<ThRoleSyncResult> {
  const guildId = process.env.DISCORD_GUILD_ID?.trim();
  if (!guildId || !process.env.DISCORD_BOT_TOKEN?.trim()) return { skipped: 'DISCORD_GUILD_ID / DISCORD_BOT_TOKEN not set' };

  const now = opts.now ?? new Date();
  const { data: state, error: stateError } = await supabase
    .from('discord_th_role_sync')
    .select('completed_at')
    .eq('id', true)
    .maybeSingle();
  if (stateError) throw stateError;
  if (!state) return { skipped: 'discord_th_role_sync has no row (migration 041 not applied?)' };
  if (!opts.force && !isDue(state.completed_at, now)) return { skipped: 'not due' };

  // Claim the pass so an overlapping sync (cron + dashboard) cannot create the same role twice.
  const { data: claimed, error: claimError } = await supabase
    .from('discord_th_role_sync')
    .update({ claimed_at: now.toISOString() })
    .eq('id', true)
    .lt('claimed_at', new Date(now.getTime() - CLAIM_STALE_MS).toISOString())
    .select('id');
  if (claimError) throw claimError;
  if (!claimed?.length) return { skipped: 'another pass is running' };

  try {
    const result = await runPass(guildId, opts.deadline);
    if (result.complete) {
      const { error } = await supabase.from('discord_th_role_sync').update({ completed_at: now.toISOString() }).eq('id', true);
      if (error) throw error;
    }
    return result;
  } finally {
    await supabase.from('discord_th_role_sync').update({ claimed_at: new Date(0).toISOString() }).eq('id', true);
  }
}

async function runPass(guildId: string, callerDeadline?: number) {
  // Real elapsed time, not the caller's `now` (which only decides what day it is).
  const deadline = Math.min(Date.now() + BUDGET_MS, callerDeadline ?? Infinity);
  const outOfTime = () => Date.now() >= deadline;

  // Flat selects joined here, so the pass runs on fakeSupabase (which does not resolve embeds).
  const { data: accountRows, error: accountsError } = await supabase
    .from('player_accounts')
    .select('person_id, th_level')
    .eq('status', 'active');
  if (accountsError) throw accountsError;
  const accounts = (accountRows as RoleAccount[]) || [];
  // A family with no active accounts is a bad read, not a fact — acting on it would strip every TH
  // role in the server. Same rule as the roster sync's empty-roster refusal.
  if (!accounts.length) throw new Error('No active accounts read — refusing to plan TH roles');

  const { data: personRows, error: personsError } = await supabase
    .from('persons')
    .select('id, discord_user_id')
    .not('discord_user_id', 'is', null);
  if (personsError) throw personsError;
  const discordByPerson = new Map(
    ((personRows as { id: string; discord_user_id: string | null }[]) || []).map((p) => [p.id, p.discord_user_id]),
  );

  const { data: storedRows, error: storedError } = await supabase.from('discord_th_roles').select('th_level, role_id');
  if (storedError) throw storedError;
  const stored = new Map(((storedRows as { th_level: number; role_id: string }[]) || []).map((r) => [r.th_level, r.role_id]));

  const guildRoles = (await discordBotRequest('GET', `/guilds/${guildId}/roles`)) as GuildRole[] | null;
  if (!guildRoles) throw new Error('Could not read the guild roles');

  const { roleIds, toCreate, adopted } = resolveRoles(roleLevels(accounts.map((a) => a.th_level)), stored, guildRoles);

  const created: number[] = [];
  for (const level of toCreate) {
    const role = (await discordBotRequest('POST', `/guilds/${guildId}/roles`, {
      name: thRoleName(level),
      mentionable: false,
      hoist: false,
    })) as { id?: string } | null;
    if (!role?.id) continue; // logged by the transport; retried on the next pass
    roleIds.set(level, role.id);
    created.push(level);
  }
  // Store before assigning anything: a role created but forgotten would be re-adopted by name next
  // pass anyway, but a stored id is what survives a leader renaming it.
  const toStore = [...created, ...adopted].map((level) => ({ th_level: level, role_id: roleIds.get(level)! }));
  if (toStore.length) {
    const { error } = await supabase.from('discord_th_roles').upsert(toStore, { onConflict: 'th_level' });
    if (error) throw error;
  }

  const desired = desiredLevels(accounts, discordByPerson);
  const members = (await listMembers(guildId)) ?? (await lookupMembers(guildId, [...new Set(discordByPerson.values())], outOfTime));

  let added = 0;
  let removed = 0;
  let failed = 0;
  // A failed request (missing permission, a member above the bot) is retried tomorrow, not every
  // sync; only running out of time leaves the pass open — including during the member lookups, which
  // then return a partial list.
  let complete = !outOfTime();
  for (const change of planRoleChanges(members, desired, roleIds)) {
    if (outOfTime()) {
      complete = false;
      break;
    }
    const ok = await discordBotRequest(
      change.op === 'add' ? 'PUT' : 'DELETE',
      `/guilds/${guildId}/members/${change.userId}/roles/${change.roleId}`,
    );
    if (!ok) failed++;
    else if (change.op === 'add') added++;
    else removed++;
  }

  return { created, adopted, added, removed, failed, members: members.length, complete };
}

/** Every human member of the server, or null when the bot may not list them (no members intent). */
async function listMembers(guildId: string): Promise<GuildMember[] | null> {
  const out: GuildMember[] = [];
  let after = '0';
  for (;;) {
    const page = (await discordBotRequest('GET', `/guilds/${guildId}/members?limit=1000&after=${after}`)) as RawMember[] | null;
    if (!Array.isArray(page)) {
      console.error('TH roles: cannot list guild members — enable the Server Members intent for full cleanup. Falling back to per-person lookups.');
      return null;
    }
    for (const m of page) {
      if (m.user?.id && !m.user.bot) out.push({ userId: m.user.id, roles: m.roles ?? [] });
    }
    if (page.length < 1000) return out;
    after = page[page.length - 1].user?.id ?? after;
  }
}

/** The members behind the given Discord ids, one lookup each; ids not in the server are skipped. */
async function lookupMembers(guildId: string, ids: (string | null)[], outOfTime: () => boolean): Promise<GuildMember[]> {
  const queue = [...new Set(ids.map(normalizeDiscordId).filter((id): id is string => !!id))];
  const out: GuildMember[] = [];
  const worker = async () => {
    for (let id = queue.shift(); id && !outOfTime(); id = queue.shift()) {
      const m = (await discordBotRequest('GET', `/guilds/${guildId}/members/${id}`)) as RawMember | null;
      if (m?.user?.id) out.push({ userId: m.user.id, roles: m.roles ?? [] });
    }
  };
  await Promise.all(Array.from({ length: LOOKUP_CONCURRENCY }, worker));
  return out;
}
