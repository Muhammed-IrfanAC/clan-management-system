import { NextResponse, NextRequest } from 'next/server';
import { syncClan } from '@/lib/sync';
import { expireDepartedBabies } from '@/lib/babies';
import { supabase } from '@/lib/supabase';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const token = request.cookies.get('clanops-auth')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    try {
      await jwtVerify(token, JWT_SECRET);
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    let clanId;
    try {
      const body = await request.json();
      clanId = body.clanId;
    } catch (e) {
      // Body is empty or not JSON, continue with clanId = undefined
    }

    if (clanId) {
      const result = await syncClan(clanId);
      return NextResponse.json(result);
    }

    // If no clanId, sync all active clans
    const { data: clans } = await supabase.from('clans').select('id').eq('active', true);
    if (!clans) return NextResponse.json({ success: true, count: 0 });

    const results = await Promise.all(clans.map(c => syncClan(c.id)));

    // Every active clan is now reconciled in this single pass, so a baby with no
    // active account anywhere has genuinely left the family (not just moved between
    // clans). Drop those personas immediately rather than waiting out the trial.
    const { expired: departedBabies } = await expireDepartedBabies();

    return NextResponse.json({
      success: true,
      clansSynced: results.length,
      totalUpdated: results.reduce((acc, r) => acc + r.count, 0),
      departedBabies,
    });

  } catch (error: any) {
    console.error('API Sync Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
