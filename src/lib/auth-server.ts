import { NextResponse, NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { supabase } from './supabase';
import { AccessRole } from '@/types/database';
import { Capability, can } from './permissions';
import { loadCapabilityOverrides } from './permissions-server';
import { jwtSecret } from './auth/jwtSecret';

/**
 * Server-side auth + authorization helpers, shared by every API route.
 *
 * Two layers, deliberately separated:
 *  - IDENTITY comes from the signed session cookie (fast, no DB): who is acting → attribution.
 *  - AUTHORIZATION re-reads the LIVE access_role from the database (via the account's linked person),
 *    so a demotion or a revoked access takes effect immediately, not on the next login. The JWT's
 *    role is only a hint. Because access lives on the person, revoking it blocks ALL of their alts.
 */

export interface AuthContext {
  playerTag: string;
  role: AccessRole; // role as carried by the JWT (may be stale — do not authorize on this alone)
}

/** Thrown by the helpers below; convert with `authErrorResponse` in a route's catch. */
export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Verify the session cookie and return the acting identity. Throws AuthError(401) if absent/invalid. */
export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const token = request.cookies.get('clanops-auth')?.value;
  if (!token) throw new AuthError('Unauthorized', 401);
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    const playerTag = payload.playerTag as string | undefined;
    if (!playerTag) throw new AuthError('Invalid token', 401);
    return { playerTag, role: (payload.role as AccessRole) ?? 'co_leader' };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError('Invalid token', 401);
  }
}

/**
 * Fetch the LIVE dashboard role for an account, resolved through its linked person's access_role,
 * together with that person's id (so author checks need not look the actor up again). `role` is null
 * if the account is missing, unlinked, or the person holds no access (revoked/never granted). One
 * query via the person_id FK embed.
 */
async function liveAccess(playerTag: string): Promise<{ role: AccessRole | null; personId: string | null }> {
  const { data } = await supabase
    .from('player_accounts')
    .select('person_id, person:persons(access_role)')
    .eq('player_tag', playerTag)
    .maybeSingle();
  // person:persons(...) resolves the to-one relation; may be an object or null when unlinked.
  const row = data as { person_id?: string | null; person?: { access_role?: AccessRole | null } | null } | null;
  return { role: row?.person?.access_role ?? null, personId: row?.person_id ?? null };
}

async function liveRole(playerTag: string): Promise<AccessRole | null> {
  return (await liveAccess(playerTag)).role;
}

/**
 * Require a capability, checked against the LIVE database role. Throws AuthError(403) if access
 * was revoked or the role does not hold the capability. Returns the live role on success.
 */
export async function requireCapability(auth: AuthContext, cap: Capability): Promise<AccessRole> {
  const role = await liveRole(auth.playerTag);
  if (!role) throw new AuthError('Access has been revoked', 403);
  const overrides = await loadCapabilityOverrides();
  if (!can(role, cap, overrides)) throw new AuthError('You do not have permission to perform this action', 403);
  return role;
}

/**
 * Capability check for a role the caller has ALREADY read live — the role `authorizeActive` returns.
 * Costs no query (the overrides are cached), unlike `hasCapability`, which re-reads the role.
 */
export async function roleCan(role: AccessRole, cap: Capability): Promise<boolean> {
  return can(role, cap, await loadCapabilityOverrides());
}

/**
 * Whether the actor may change content authored by `authorTag`: the author themselves, any alt of
 * the same person (authorship is at the person level), or a holder of `content.override`. The
 * actor's person and role come from `authorizeActive`, so this is at most one lookup — the author's.
 */
export async function canModifyAuthored(auth: ActiveAuth, authorTag: string | null): Promise<boolean> {
  if (authorTag && authorTag === auth.actorTag) return true;
  const [authorPerson, override] = await Promise.all([
    authorTag ? personIdForTag(authorTag) : Promise.resolve(null),
    roleCan(auth.role, 'content.override'),
  ]);
  return override || (!!authorPerson && !!auth.personId && authorPerson === auth.personId);
}

async function personIdForTag(tag: string): Promise<string | null> {
  const { data } = await supabase.from('player_accounts').select('person_id').eq('player_tag', tag).maybeSingle();
  return (data as { person_id: string | null } | null)?.person_id ?? null;
}

/** Non-throwing capability probe (live DB role + runtime overrides). Widens author-only checks. */
export async function hasCapability(playerTag: string, cap: Capability): Promise<boolean> {
  const role = await liveRole(playerTag);
  if (!role) return false;
  return can(role, cap, await loadCapabilityOverrides());
}

/** In a route's catch: turn an AuthError into its NextResponse, or return null to rethrow/500. */
export function authErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
  return null;
}

/**
 * Identity + liveness gate for mutating routes, in the `{ actorTag, role } | { error }` shape the
 * routes already use. Verifies the session cookie AND that the account STILL has dashboard access —
 * this is what closes the "revoked mid-session" gap: a valid cookie alone is no longer sufficient,
 * a revoked or deleted account is rejected on the very next request rather than at cookie expiry.
 */
export async function authorizeActive(
  request: NextRequest,
): Promise<
  | (ActiveAuth & { error?: undefined })
  | { error: NextResponse; actorTag?: undefined; role?: undefined; personId?: undefined }
> {
  let auth: AuthContext;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return { error: authErrorResponse(e) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const { role, personId } = await liveAccess(auth.playerTag);
  if (!role) return { error: NextResponse.json({ error: 'Access has been revoked' }, { status: 403 }) };
  return { actorTag: auth.playerTag, role, personId };
}

/** An actor `authorizeActive` has verified: identity, LIVE role, and the person the account links to. */
export interface ActiveAuth {
  actorTag: string;
  role: AccessRole;
  personId: string | null;
}

/**
 * `authorizeActive` for a read-only view, overlapped with the view's own queries. The session cookie
 * is verified first — no database work for an unauthenticated caller — and then the live role check
 * runs alongside `load`, saving the round trip a page load otherwise spends waiting on it. If access
 * has been revoked the loaded data is discarded, never returned. Only for loads with no side effects.
 */
export async function authorizeActiveView<T>(
  request: NextRequest,
  load: () => Promise<T>,
): Promise<{ data: T; auth: ActiveAuth; error?: undefined } | { error: NextResponse; data?: undefined; auth?: undefined }> {
  let auth: AuthContext;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return { error: authErrorResponse(e) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const [access, data] = await Promise.all([liveAccess(auth.playerTag), load()]);
  if (!access.role) return { error: NextResponse.json({ error: 'Access has been revoked' }, { status: 403 }) };
  return { data, auth: { actorTag: auth.playerTag, role: access.role, personId: access.personId } };
}
