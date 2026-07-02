import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

export async function GET(request: NextRequest) {
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

    const { data: user, error } = await supabase
      .from('player_accounts')
      .select('*, person:persons(access_role)')
      .eq('player_tag', decoded.playerTag)
      .single();

    if (error || !user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    // The LIVE dashboard permission is the linked person's access_role (null = access revoked).
    // Resolving it here means the UI reflects a grant/revoke without a re-login.
    const role = (user as { person?: { access_role?: string | null } | null }).person?.access_role ?? null;

    return NextResponse.json({ user, role });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
