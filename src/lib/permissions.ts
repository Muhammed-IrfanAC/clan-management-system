import { AccessRole } from '@/types/database';

/**
 * Role-Based Access Control (capability model).
 *
 * Authorization is expressed as CAPABILITIES, not raw role checks scattered through the code.
 * A role owns a set of capabilities; features ask `can(role, capability)`. Adding a screen means
 * granting a capability — not re-auditing every `if (role === ...)`. Pure and React-free so both
 * API routes (the real enforcement boundary) and UI (button visibility) import the same source.
 *
 * The role here is the PERSON's `access_role` (dashboard permission), NOT an account's clan rank.
 * Tiers: a single `super_admin`, many `leader`s, many `co_leader`s. A person with no access_role
 * (NULL) holds no capabilities and cannot log in — access is granted, never implied by in-game rank.
 */

export type Capability =
  | 'content.override'      // edit/delete warnings, logs and notes authored by OTHER people
  | 'clan.create'           // register a new family clan
  | 'account.delete'        // permanently delete a player account
  | 'leader.manage'         // add leaders, grant/revoke dashboard access
  | 'rules.delete'          // permanently delete a rule from the library
  | 'role.assign_any'       // assign any access_role (incl. leader / super_admin)
  | 'role.assign_coleader'; // assign the co_leader role only

const SUPER_ADMIN: Capability[] = [
  'content.override',
  'clan.create',
  'account.delete',
  'leader.manage',
  'rules.delete',
  'role.assign_any',
  'role.assign_coleader',
];

// Leaders are unrestricted operationally, but role elevation is capped at co_leader — promoting to
// leader/super_admin stays a super_admin (or direct-DB) action, keeping the single-owner model intact.
const LEADER: Capability[] = [
  'content.override',
  'clan.create',
  'account.delete',
  'leader.manage',
  'rules.delete',
  'role.assign_coleader',
];

export const ROLE_CAPS: Record<AccessRole, Set<Capability>> = {
  super_admin: new Set(SUPER_ADMIN),
  leader: new Set(LEADER),
  // Co-leaders may create/edit rules and log freely, but DELETING a rule is a leader/super-admin
  // action (rules.delete) — the only gated Rules capability.
  co_leader: new Set(),
};

/** Does this role hold the given capability? */
export function can(role: AccessRole | null | undefined, cap: Capability): boolean {
  if (!role) return false;
  return ROLE_CAPS[role]?.has(cap) ?? false;
}

/**
 * Which access_role values may `assignerRole` grant when provisioning/managing a leader?
 * super_admin → every tier; leader → co_leader only; everyone else → nothing.
 * Note: super_admin is intentionally omitted even for super_admins so the UI steers new owners
 * through a deliberate direct-DB action rather than minting a second owner by accident.
 */
export function assignableRoles(assignerRole: AccessRole | null | undefined): AccessRole[] {
  if (can(assignerRole, 'role.assign_any')) return ['leader', 'co_leader'];
  if (can(assignerRole, 'role.assign_coleader')) return ['co_leader'];
  return [];
}

/** Guard: may `assignerRole` grant/revoke a target person's `targetRole`? */
export function canAssignRole(assignerRole: AccessRole | null | undefined, targetRole: AccessRole): boolean {
  if (can(assignerRole, 'role.assign_any')) return targetRole !== 'super_admin';
  if (can(assignerRole, 'role.assign_coleader')) return targetRole === 'co_leader';
  return false;
}
