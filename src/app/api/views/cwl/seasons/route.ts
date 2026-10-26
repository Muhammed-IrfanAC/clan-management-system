import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

/** Every CWL season, newest first — the CWL screen's season picker. */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;
    const { data, error } = await supabase.from('cwl_seasons').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error) {
    console.error('API CWL Seasons View Error:', error);
    return NextResponse.json({ error: 'Failed to load seasons' }, { status: 500 });
  }
}
