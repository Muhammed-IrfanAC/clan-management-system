/**
 * Town-hall roles on the family Discord: the PURE half of `thRoleSync.ts`.
 *
 * Every person with a linked Discord carries one `TH<n>` role per town hall level among their ACTIVE
 * accounts — a TH17 main and a TH12 alt hold both, because the role answers "who can fill a TH12
 * slot", which is a question about accounts, not people. Below `MIN_TH_ROLE` nothing is assigned.
 *
 * The set of roles is derived, never configured: one per level from `MIN_TH_ROLE` up to the highest
 * town hall any active account has reached. A new town hall release therefore needs no code change —
 * the first account to upgrade brings its role into existence on the next pass.
 *
 * The bot only ever touches the roles it manages (the ids it stored when it created or adopted them),
 * so a hand-made "TH Pushers" role, or anything else on a member, is left alone.
 */

import { normalizeDiscordId } from '@/lib/discord/format';

export const MIN_TH_ROLE = 9;

export const thRoleName = (level: number) => `TH${level}`;

/** "TH17", "th 17", "TH-17" — what a role made by hand before the bot looked like. */
const ROLE_NAME = /^\s*th\s*[-_ ]?\s*(\d{1,2})\s*$/i;

export interface RoleAccount {
  person_id: string | null;
  th_level: number | null;
}

export interface GuildRole {
  id: string;
  name: string;
  /** Owned by an integration (a bot's own role, a booster role) — never assignable by us. */
  managed?: boolean;
}

export interface GuildMember {
  userId: string;
  roles: string[];
}

export interface RoleChange {
  userId: string;
  roleId: string;
  level: number;
  op: 'add' | 'remove';
}

/** Every level that should have a role: `MIN_TH_ROLE` to the highest active level, else none. */
export function roleLevels(levels: (number | null)[]): number[] {
  const max = Math.max(0, ...levels.filter((l): l is number => typeof l === 'number' && Number.isFinite(l)));
  const out: number[] = [];
  for (let l = MIN_TH_ROLE; l <= max; l++) out.push(l);
  return out;
}

/**
 * Which guild role stands for each level, and which levels still need one made.
 *
 * A stored id wins while the role still exists, so a leader renaming or recolouring "TH17" changes
 * nothing. Without one, a hand-made role with the matching name is ADOPTED rather than duplicated —
 * the server may already have had TH roles before the bot did. A stored role that was deleted from
 * the server is re-made: the system is the authority on these roles, and silently dropping a level
 * would leave its holders unmarked.
 *
 * Stored levels outside `levels` (the family's top TH account left) stay managed, so their holders
 * are still cleaned up instead of the role being forgotten with members on it.
 */
export function resolveRoles(
  levels: number[],
  stored: Map<number, string>,
  guildRoles: GuildRole[],
): { roleIds: Map<number, string>; toCreate: number[]; adopted: number[] } {
  const live = new Map(guildRoles.filter((r) => !r.managed).map((r) => [r.id, r]));
  const byName = new Map<number, string>();
  for (const r of live.values()) {
    const m = ROLE_NAME.exec(r.name);
    if (m && !byName.has(Number(m[1]))) byName.set(Number(m[1]), r.id);
  }

  const roleIds = new Map<number, string>();
  const toCreate: number[] = [];
  const adopted: number[] = [];
  const all = [...new Set([...levels, ...stored.keys()])].sort((a, b) => a - b);
  for (const level of all) {
    const storedId = stored.get(level);
    if (storedId && live.has(storedId)) {
      roleIds.set(level, storedId);
    } else if (byName.has(level)) {
      roleIds.set(level, byName.get(level)!);
      adopted.push(level);
    } else if (levels.includes(level)) {
      toCreate.push(level);
    }
  }
  return { roleIds, toCreate, adopted };
}

/** Discord user id → the TH levels their person's active accounts are at (≥ `MIN_TH_ROLE`). */
export function desiredLevels(
  accounts: RoleAccount[],
  discordByPerson: Map<string, string | null>,
): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>();
  for (const a of accounts) {
    if (!a.person_id || typeof a.th_level !== 'number' || a.th_level < MIN_TH_ROLE) continue;
    const userId = normalizeDiscordId(discordByPerson.get(a.person_id));
    if (!userId) continue;
    let set = out.get(userId);
    if (!set) out.set(userId, (set = new Set()));
    set.add(a.th_level);
  }
  return out;
}

/**
 * The adds and removes that make every member's managed roles exactly what they should be. Any
 * member holding a managed role they no longer qualify for loses it — upgraded past it, left the
 * family, or never linked at all — and roles the bot does not manage are never mentioned. A person
 * who should have a role but is not in the server simply produces nothing.
 */
export function planRoleChanges(
  members: GuildMember[],
  desired: Map<string, Set<number>>,
  roleIds: Map<number, string>,
): RoleChange[] {
  const levelOf = new Map([...roleIds].map(([level, id]) => [id, level]));
  const changes: RoleChange[] = [];
  for (const m of members) {
    const want = desired.get(m.userId) ?? new Set<number>();
    const have = new Set(m.roles.filter((r) => levelOf.has(r)));
    for (const roleId of have) {
      const level = levelOf.get(roleId)!;
      if (!want.has(level)) changes.push({ userId: m.userId, roleId, level, op: 'remove' });
    }
    for (const level of [...want].sort((a, b) => a - b)) {
      const roleId = roleIds.get(level);
      if (roleId && !have.has(roleId)) changes.push({ userId: m.userId, roleId, level, op: 'add' });
    }
  }
  return changes;
}

/** A finished pass holds for a day; an unfinished one (or none yet) is due now. */
export function isDue(lastCompletedAt: string | null | undefined, now: Date, intervalMs = 24 * 60 * 60 * 1000): boolean {
  if (!lastCompletedAt) return true;
  const t = new Date(lastCompletedAt).getTime();
  return !Number.isFinite(t) || now.getTime() - t >= intervalMs;
}
