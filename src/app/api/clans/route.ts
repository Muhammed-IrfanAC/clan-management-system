import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

async function auth(request: NextRequest) {
  const token = request.cookies.get('clanops-auth')?.value;
  if (!token) throw new Error('Unauthorized');
  await jwtVerify(token, JWT_SECRET);
}

export async function POST(request: NextRequest) {
  try {
    await auth(request);
    const { clan_tag, display_name, clan_type, display_order } = await request.json();
    const { data, error } = await supabase.from('clans').insert([{ clan_tag, display_name, clan_type, display_order }]).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
