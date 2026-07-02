import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';

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
