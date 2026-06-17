import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

async function auth(request: Request) {
  const token = request.cookies.get('clanops-auth')?.value;
  if (!token) throw new Error('Unauthorized');
  await jwtVerify(token, JWT_SECRET);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ tag: string }> }) {
  try {
    const { tag } = await params;
    const decodedTag = decodeURIComponent(tag);
    await auth(request);
    
    // Check if player exists
    const { data: player } = await supabase.from('player_accounts').select('person_id').eq('player_tag', decodedTag).single();
    
    const { error } = await supabase.from('player_accounts').delete().eq('player_tag', decodedTag);
    if (error) throw error;

    // Cleanup person if they have no more accounts
    if (player?.person_id) {
        const { count } = await supabase.from('player_accounts').select('*', { count: 'exact', head: true }).eq('person_id', player.person_id);
        if (count === 0) {
            await supabase.from('persons').delete().eq('id', player.person_id);
        }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
