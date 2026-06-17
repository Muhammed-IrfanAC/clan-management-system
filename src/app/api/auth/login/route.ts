import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { fetchFromCoC, CoCPlayer } from '@/lib/coc-api';
import { SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

export async function POST(request: Request) {
  try {
    const { playerTag } = await request.json();

    if (!playerTag) {
      return NextResponse.json({ error: 'Player tag is required' }, { status: 400 });
    }

    // Normalized tag (uppercase, remove # if present)
    const normalizedTag = playerTag.startsWith('#') ? playerTag.toUpperCase() : `#${playerTag.toUpperCase()}`;

    // Layer 2: Check DB first
    const { data: dbPlayer, error: dbError } = await supabase
      .from('player_accounts')
      .select('*')
      .eq('player_tag', normalizedTag)
      .single();

    if (dbPlayer) {
      if (!dbPlayer.access_enabled) {
        return NextResponse.json({ error: 'Access denied for this player' }, { status: 403 });
      }
      return createAuthResponse(dbPlayer);
    }

    // Layer 1: Check CoC API
    let cocPlayer: CoCPlayer;
    try {
      cocPlayer = await fetchFromCoC<CoCPlayer>(`/players/${encodeURIComponent(normalizedTag)}`);
      console.log(`[Auth] Player: ${cocPlayer.name}, Role: ${cocPlayer.role}, Clan: ${cocPlayer.clan?.tag}`);
    } catch (err: any) {
      return NextResponse.json({ error: 'Player not found in Clash of Clans' }, { status: 404 });
    }

    // Check if player is in one of the family clans and is a leader/coleader
    const { data: clans } = await supabase.from('clans').select('clan_tag');
    const familyClanTags = clans?.map(c => c.clan_tag) || [];

    if (!cocPlayer.clan || !familyClanTags.includes(cocPlayer.clan.tag)) {
      return NextResponse.json({ error: 'Player is not in a registered clan family' }, { status: 403 });
    }

    const isAuthorizedRole = ['leader', 'coLeader'].includes(cocPlayer.role);
    if (!isAuthorizedRole) {
      return NextResponse.json({ error: 'Only Leaders and Co-Leaders can access the dashboard' }, { status: 403 });
    }

    // Create entry in DB (Layer 1 onboarding)
    // First, check if there's a person for this player or create one
    const { data: person } = await supabase
      .from('persons')
      .insert([{ display_name: cocPlayer.name }])
      .select()
      .single();

    const { data: newPlayer, error: insertError } = await supabase
      .from('player_accounts')
      .insert([{
        player_tag: normalizedTag,
        person_id: person?.id,
        clan_id: (await supabase.from('clans').select('id').eq('clan_tag', cocPlayer.clan.tag).single()).data?.id,
        db_role: cocPlayer.role === 'leader' ? 'leader' : 'co_leader',
        access_enabled: true,
        in_game_name: cocPlayer.name,
        th_level: cocPlayer.townHallLevel,
        status: 'active'
      }])
      .select()
      .single();

    if (insertError) {
      return NextResponse.json({ error: 'Failed to create leadership entry' }, { status: 500 });
    }

    return createAuthResponse(newPlayer);

  } catch (error: any) {
    console.error('Auth error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function createAuthResponse(player: any) {
  const token = await new SignJWT({ 
    playerTag: player.player_tag,
    role: player.db_role 
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(JWT_SECRET);

  const response = NextResponse.json({ success: true, user: player });
  
  response.cookies.set('clanops-auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 // 1 day
  });

  return response;
}
