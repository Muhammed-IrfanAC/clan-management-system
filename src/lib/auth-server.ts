import { NextResponse, NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { supabase } from './supabase';
import { AccessRole } from '@/types/database';
import { Capability, can } from './permissions';
import { loadCapabilityOverrides } from './permissions-server';

/**
 * Server-side auth + authorization helpers, shared by every API route.
 *
 * Two layers, deliberately separated:
 *  - IDENTITY comes from the signed session cookie (fast, no DB): who is acting → attribution.
 *  - AUTHORIZATION re-reads the LIVE access_role from the database (via the account's linked person),
 *    so a demotion or a revoked access takes effect immediately, not on the next login. The JWT's
 *    role is only a hint. Because access lives on the person, revoking it blocks ALL of their alts.
 */

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

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
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const playerTag = payload.playerTag as string | undefined;
    if (!playerTag) throw new AuthError('Invalid token', 401);
    return { playerTag, role: (payload.role as AccessRole) ?? 'co_leader' };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new AuthError('Invalid token', 401);
  }
}

/**
 * Fetch the LIVE dashboard role for an account, resolved through its linked person's access_role.
 * Returns null if the account is missing, unlinked, or the person holds no access (revoked/never
 * granted). One query via the person_id FK embed.
 */
async function liveRole(playerTag: string): Promise<AccessRole | null> {
  const { data } = await supabase
    .from('player_accounts')
    .select('person:persons(access_role)')
    .eq('player_tag', playerTag)
    .maybeSingle();
  // person:persons(...) resolves the to-one relation; may be an object or null when unlinked.
  const person = (data as { person?: { access_role?: AccessRole | null } | null } | null)?.person;
  return person?.access_role ?? null;
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
  | { actorTag: string; role: AccessRole; error?: undefined }
  | { error: NextResponse; actorTag?: undefined; role?: undefined }
> {
  let auth: AuthContext;
  try {
    auth = await requireAuth(request);
  } catch (e) {
    return { error: authErrorResponse(e) ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const role = await liveRole(auth.playerTag);
  if (!role) return { error: NextResponse.json({ error: 'Access has been revoked' }, { status: 403 }) };
  return { actorTag: auth.playerTag, role };
}
