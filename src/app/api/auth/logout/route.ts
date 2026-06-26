import { NextResponse } from 'next/server';

// The auth cookie is httpOnly, so it can't be cleared from client JS.
// Expire it server-side here.
export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set('clanops-auth', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
