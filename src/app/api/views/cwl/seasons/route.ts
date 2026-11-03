import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActiveView } from '@/lib/auth-server';

/**
 * Every CWL season, newest first — the CWL screen's and the war planner's season picker. Each season
 * embeds its clans: labels default to the month and clans may run their own season for it, so the
 * pickers name a season by its clans.
 */
export async function GET(request: NextRequest) {
  try {
    // The live role check runs alongside these reads (see authorizeActiveView).
    const view = await authorizeActiveView(request, async () => {
      const { data, error } = await supabase
        .from('cwl_seasons')
        .select('*, season_clans:cwl_season_clans(clan_id)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return NextResponse.json(data);
    });
    return view.error ?? view.data;
  } catch (error) {
    console.error('API CWL Seasons View Error:', error);
    return NextResponse.json({ error: 'Failed to load seasons' }, { status: 500 });
  }
}
