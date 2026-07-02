import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { SignJWT } from 'jose';
import { AccessRole } from '@/types/database';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

export async function POST(request: Request) {
  try {
    const { playerTag } = await request.json();

    if (!playerTag) {
      return NextResponse.json({ error: 'Player tag is required' }, { status: 400 });
    }

    // Normalized tag (uppercase, remove # if present)
    const normalizedTag = playerTag.startsWith('#') ? playerTag.toUpperCase() : `#${playerTag.toUpperCase()}`;

    // Access is a property of the PERSON, not the account or the clan they currently sit in. We look
    // up the account only to resolve its linked person, then gate purely on that person's access_role.
    // Consequence (by design): ANY tag linked to an access-holding person can log in — including alts
    // parked outside the family clans — and in-game rank / clan membership is no longer a login gate.
    const { data: account } = await supabase
      .from('player_accounts')
      .select('*, person:persons(access_role)')
      .eq('player_tag', normalizedTag)
      .maybeSingle();

    const accessRole =
      (account as { person?: { access_role?: AccessRole | null } | null } | null)?.person?.access_role ?? null;

    if (!account || !accessRole) {
      // Either the tag isn't registered yet (accounts arrive via clan sync) or its person has not
      // been granted access. Access is granted deliberately in Settings or directly in the DB.
      return NextResponse.json({ error: 'This account has no dashboard access' }, { status: 403 });
    }

    return createAuthResponse(account, accessRole);

  } catch (error: any) {
    console.error('Auth error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function createAuthResponse(player: any, role: AccessRole) {
  const token = await new SignJWT({
    playerTag: player.player_tag,
    role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(JWT_SECRET);

  const response = NextResponse.json({ success: true, user: player });

  response.cookies.set('clanops-auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30 // 30 days; middleware slides this forward on activity
  });

  return response;
}
