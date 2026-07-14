import { NextResponse, NextRequest } from 'next/server';
import { syncClan } from '@/lib/sync';
import { expireDepartedBabies } from '@/lib/babies';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { syncCwlLiveState } from '@/lib/cwl/live';

/**
 * Refresh live CWL round/lineup data as part of a sync, but never let it fail the roster sync —
 * a CoC hiccup or off-season clan must not block the primary result. Returns null on any error.
 */
async function safeCwlSync() {
  try {
    return await syncCwlLiveState();
  } catch (err) {
    console.error('CWL live sync error (non-fatal):', err);
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check (identity + live dashboard access)
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    let clanId;
    try {
      const body = await request.json();
      clanId = body.clanId;
    } catch (e) {
      // Body is empty or not JSON, continue with clanId = undefined
    }

    if (clanId) {
      const result = await syncClan(clanId);
      const cwl = await safeCwlSync();
      return NextResponse.json({ ...result, cwl });
    }

    // If no clanId, sync all active clans
    const { data: clans } = await supabase.from('clans').select('id').eq('active', true);
    if (!clans) return NextResponse.json({ success: true, count: 0 });

    const results = await Promise.all(clans.map(c => syncClan(c.id)));

    // Every active clan is now reconciled in this single pass, so a baby with no
    // active account anywhere has genuinely left the family (not just moved between
    // clans). Drop those personas immediately rather than waiting out the trial.
    const { expired: departedBabies } = await expireDepartedBabies();
    const cwl = await safeCwlSync();

    return NextResponse.json({
      success: true,
      clansSynced: results.length,
      totalUpdated: results.reduce((acc, r) => acc + r.count, 0),
      departedBabies,
      cwl,
    });

  } catch (error: any) {
    console.error('API Sync Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
