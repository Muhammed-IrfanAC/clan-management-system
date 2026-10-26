/**
 * The key that signs and verifies the `clanops-auth` session cookie. Fails closed: there used to be
 * a hard-coded fallback for a missing JWT_SECRET, and a deploy that forgot the env var would sign
 * sessions with a string anyone can read in this repository — i.e. anyone could mint a super_admin
 * cookie. Read per call rather than at import, so a build without the env var still compiles.
 */
export function jwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set — refusing to sign or verify sessions.');
  return new TextEncoder().encode(secret);
}
