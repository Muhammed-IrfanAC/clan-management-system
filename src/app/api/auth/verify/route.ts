import { NextResponse } from 'next/server';
import { verifyLoginChallenge } from '@/lib/auth/loginChallenge';
import { sessionResponse } from '@/lib/auth/session';

/** Step 2 of login: exchange the code from the Discord DM for a session cookie. */
export async function POST(request: Request) {
  try {
    const { challengeId, code } = await request.json().catch(() => ({}));
    const result = await verifyLoginChallenge(challengeId, code);
    switch (result.kind) {
      case 'ok':
        return sessionResponse(result.playerTag, result.role, { success: true });
      case 'wrong_code':
        return NextResponse.json(
          { error: `That code is not right. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'try' : 'tries'} left.` },
          { status: 401 },
        );
      case 'expired':
        return NextResponse.json({ error: 'That code has expired. Send a new one.', restart: true }, { status: 401 });
      case 'locked':
        return NextResponse.json({ error: 'Too many wrong codes. Send a new one.', restart: true }, { status: 401 });
      case 'no_access':
        return NextResponse.json({ error: 'This account has no dashboard access', restart: true }, { status: 403 });
      case 'invalid':
        return NextResponse.json({ error: 'That code is not valid. Send a new one.', restart: true }, { status: 401 });
    }
  } catch (error) {
    console.error('Auth verify error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
