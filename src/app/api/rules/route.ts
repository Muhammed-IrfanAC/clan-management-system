import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;
    const { name, description, logging_guidance } = await request.json();
    const { data, error } = await supabase.from('rules').insert([{ name, description, logging_guidance }]).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
