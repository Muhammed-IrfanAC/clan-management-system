import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('clanops-auth')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const { data: logs, error } = await supabase
      .from('leadership_logs')
      .select(`
        *,
        clan:clans (*),
        person:persons (*),
        activity_notes (*)
      `)
      .order('pinned', { ascending: false })
      .order('logged_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(logs);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('clanops-auth')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    let decoded: any;
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      decoded = payload;
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { category, clanId, personId, description, pinned } = await request.json();

    if (!category || !description) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('leadership_logs')
      .insert([{
        logged_by: decoded.playerTag,
        logged_at: new Date().toISOString(),
        category,
        clan_id: clanId || null,
        related_person_id: personId || null,
        description,
        pinned: pinned || false
      }])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
