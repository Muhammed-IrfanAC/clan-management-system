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

/**
 * Runtime OVERRIDES layered over the coded defaults above. Shape: role → capability → enabled.
 * A present entry wins; an absent one falls back to ROLE_CAPS. Persisted in the `role_capabilities`
 * table and loaded server-side (see permissions-server.ts). An empty map reproduces the defaults.
 */
export type CapabilityOverrides = Partial<Record<AccessRole, Partial<Record<Capability, boolean>>>>;

/**
 * Does this role hold the given capability? Pass `overrides` (from the role_capabilities table) to
 * honour runtime configuration; omit it to check the coded defaults only. Callers that gate real
 * access MUST pass the loaded overrides — the API helpers in auth-server.ts do this for every route.
 */
export function can(
  role: AccessRole | null | undefined,
  cap: Capability,
  overrides?: CapabilityOverrides,
): boolean {
  if (!role) return false;
  const override = overrides?.[role]?.[cap];
  if (typeof override === 'boolean') return override;
  return ROLE_CAPS[role]?.has(cap) ?? false;
}

/**
 * The capabilities a super_admin may grant to / revoke from CO-LEADERS via the Permissions editor.
 * `role.assign_any` is deliberately excluded: minting leaders/super-admins stays an owner-only power,
 * preserving the single-owner model even when co-leaders are given broad operational reach.
 */
export const CONFIGURABLE_CO_LEADER_CAPS: readonly Capability[] = [
  'content.override',
  'clan.create',
  'account.delete',
  'rules.delete',
  'leader.manage',
  'role.assign_coleader',
];

/** Human-facing label + description for each capability, used by the Permissions editor UI. */
export const CAPABILITY_META: Record<Capability, { label: string; description: string; sensitive?: boolean }> = {
  'content.override': {
    label: 'Override others’ content',
    description: 'Edit or delete strikes, logs and notes authored by other leaders — not just their own.',
  },
  'clan.create': {
    label: 'Manage clan family',
    description: 'Register new family clans and remove existing ones from Settings.',
  },
  'account.delete': {
    label: 'Delete accounts',
    description: 'Permanently delete a player account from the registry.',
  },
  'rules.delete': {
    label: 'Delete rules',
    description: 'Permanently remove a rule from the library (creating/editing rules is always allowed).',
  },
  'leader.manage': {
    label: 'Manage leadership',
    description: 'Grant and revoke dashboard access for other members.',
    sensitive: true,
  },
  'role.assign_coleader': {
    label: 'Assign co-leader role',
    description: 'When granting access, allow assigning the co-leader role.',
    sensitive: true,
  },
  'role.assign_any': {
    label: 'Assign any role',
    description: 'Assign the leader role (owner-only; not configurable for co-leaders).',
    sensitive: true,
  },
};

/** Every capability, derived from the metadata table — used to compute a role's effective caps. */
export const ALL_CAPABILITIES = Object.keys(CAPABILITY_META) as Capability[];

/**
 * Which access_role values may `assignerRole` grant when provisioning/managing a leader?
 * super_admin → every tier; leader → co_leader only; everyone else → nothing. Pass `overrides` to
 * honour runtime config (a co-leader granted role.assign_coleader gains ['co_leader']).
 * Note: super_admin is intentionally omitted even for super_admins so the UI steers new owners
 * through a deliberate direct-DB action rather than minting a second owner by accident.
 */
export function assignableRoles(
  assignerRole: AccessRole | null | undefined,
  overrides?: CapabilityOverrides,
): AccessRole[] {
  if (can(assignerRole, 'role.assign_any', overrides)) return ['leader', 'co_leader'];
  if (can(assignerRole, 'role.assign_coleader', overrides)) return ['co_leader'];
  return [];
}

/**
 * Client-side twin of assignableRoles that works from an already-resolved effective capability list
 * (as returned by /api/auth/me), so the UI reflects runtime overrides without needing the raw map.
 */
export function assignableRolesFromCaps(caps: Iterable<Capability>): AccessRole[] {
  const set = new Set(caps);
  if (set.has('role.assign_any')) return ['leader', 'co_leader'];
  if (set.has('role.assign_coleader')) return ['co_leader'];
  return [];
}

/** Guard: may `assignerRole` grant/revoke a target person's `targetRole`? Overrides-aware. */
export function canAssignRole(
  assignerRole: AccessRole | null | undefined,
  targetRole: AccessRole,
  overrides?: CapabilityOverrides,
): boolean {
  if (can(assignerRole, 'role.assign_any', overrides)) return targetRole !== 'super_admin';
  if (can(assignerRole, 'role.assign_coleader', overrides)) return targetRole === 'co_leader';
  return false;
}
