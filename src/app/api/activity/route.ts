import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

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
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { category, clanId, personId, description, pinned } = await request.json();

    if (!category || !description) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('leadership_logs')
      .insert([{
        logged_by: auth.actorTag,
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
