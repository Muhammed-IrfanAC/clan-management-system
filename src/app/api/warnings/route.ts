import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('clanops-auth')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const { data: warnings, error } = await supabase
      .from('warnings')
      .select(`
        *,
        person:persons (*),
        rule:rules (*),
        player_account:player_accounts (*)
      `)
      .order('logged_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(warnings);
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

    const { personId, playerTag, ruleId, description, loggedAt } = await request.json();

    if (!personId || !playerTag || !description) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Optional backdating: if a loggedAt is supplied it must be a valid date in the
    // past (you can't log a violation in the future). Blank => log as "now".
    let loggedAtIso = new Date().toISOString();
    if (loggedAt) {
      const parsed = new Date(loggedAt);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid date provided' }, { status: 400 });
      }
      if (parsed.getTime() > Date.now()) {
        return NextResponse.json({ error: 'Warning date cannot be in the future' }, { status: 400 });
      }
      loggedAtIso = parsed.toISOString();
    }

    const { data, error } = await supabase
      .from('warnings')
      .insert([{
        person_id: personId,
        player_account_tag: playerTag,
        rule_id: ruleId || null,
        description,
        logged_by: decoded.playerTag,
        logged_at: loggedAtIso,
        acknowledged: false
      }])
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
