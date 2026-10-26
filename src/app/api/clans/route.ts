import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse, authorizeActive } from '@/lib/auth-server';

// GET: every clan in display order — the dashboard's clan switcher (ClanContext).
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;
    const { data, error } = await supabase.from('clans').select('*').order('display_order');
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error('API Clans Error:', error);
    return NextResponse.json({ error: 'Failed to load clans' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    await requireCapability(auth, 'clan.create');
    const { clan_tag, display_name, clan_type, display_order } = await request.json();
    const { data, error } = await supabase.from('clans').insert([{ clan_tag, display_name, clan_type, display_order }]).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return authErrorResponse(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }
}
