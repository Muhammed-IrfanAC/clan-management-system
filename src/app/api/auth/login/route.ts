import { NextResponse } from 'next/server';
import { startLoginChallenge } from '@/lib/auth/loginChallenge';

/**
 * Step 1 of login: send a one-time code to the Discord DMs of the person the tag belongs to. No
 * session is issued here — a tag is public, so it only says WHO is trying to log in; the code sent
 * to their Discord (step 2, /api/auth/verify) is what proves it is them.
 *
 * Access is a property of the PERSON (persons.access_role), so any account linked to an
 * access-holding person can start a login, and the code goes to that person's Discord.
 */
export async function POST(request: Request) {
  try {
    const { playerTag } = await request.json().catch(() => ({}));
    if (typeof playerTag !== 'string' || !playerTag.trim()) {
      return NextResponse.json({ error: 'Player tag is required' }, { status: 400 });
    }

    const result = await startLoginChallenge(playerTag);
    switch (result.kind) {
      case 'sent':
        return NextResponse.json({ challengeId: result.challengeId, expiresAt: result.expiresAt, resendAfterSec: result.resendAfterSec });
      case 'no_access':
        return NextResponse.json({ error: 'This account has no dashboard access' }, { status: 403 });
      case 'no_discord':
        return NextResponse.json(
          { error: 'No Discord account is linked to you, so a login code cannot be sent. Ask a leader to link your Discord on your member page.' },
          { status: 403 },
        );
      case 'rate_limited':
        return NextResponse.json(
          { error: `Too many codes requested. Try again in ${result.retryAfterSec}s.`, retryAfterSec: result.retryAfterSec },
          { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } },
        );
      case 'dm_failed':
        return NextResponse.json(
          { error: "Couldn't DM you on Discord. Allow direct messages from members of the clan server (Server → Privacy Settings), then try again." },
          { status: 502 },
        );
    }
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
