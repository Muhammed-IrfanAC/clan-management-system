import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';
import type { AccessRole } from '@/types/database';
import { jwtSecret } from './jwtSecret';

export const SESSION_COOKIE = 'clanops-auth';
const SESSION_DAYS = 30;

/**
 * Sign a session for `playerTag` and set it as the httpOnly cookie on `body`'s response. The role
 * rides along only as a hint; every route re-reads the live one (auth-server.ts).
 */
export async function sessionResponse(playerTag: string, role: AccessRole, body: unknown): Promise<NextResponse> {
  const token = await new SignJWT({ playerTag, role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(jwtSecret());

  const response = NextResponse.json(body);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * SESSION_DAYS, // middleware slides this forward on activity
  });
  return response;
}
