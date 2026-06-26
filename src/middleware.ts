import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify, SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

const SESSION_DAYS = 30;
const SESSION_MAX_AGE = 60 * 60 * 24 * SESSION_DAYS;
// Re-issue the cookie once a token has less than this much life left, so active
// users get a sliding session and are never bounced mid-use. Only inactivity for
// the full window logs someone out.
const REFRESH_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

async function issueToken(payload: { playerTag: string; role?: string }) {
  return new SignJWT({ playerTag: payload.playerTag, role: payload.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(JWT_SECRET);
}

function setAuthCookie(response: NextResponse, token: string) {
  response.cookies.set('clanops-auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}

export async function middleware(request: NextRequest) {
  const token = request.cookies.get('clanops-auth')?.value;

  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    if (!token) {
      return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      const response = NextResponse.next();

      // Sliding session: refresh the cookie when it's nearing expiry.
      const expMs = (payload.exp ?? 0) * 1000;
      if (expMs - Date.now() < REFRESH_THRESHOLD_MS) {
        const fresh = await issueToken({
          playerTag: payload.playerTag as string,
          role: payload.role as string | undefined,
        });
        return setAuthCookie(response, fresh);
      }

      return response;
    } catch (err) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  if (request.nextUrl.pathname === '/login' && token) {
    try {
      await jwtVerify(token, JWT_SECRET);
      return NextResponse.redirect(new URL('/dashboard', request.url));
    } catch (err) {
      // Token invalid, allow login
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/login'],
};
