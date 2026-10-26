import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActiveView } from '@/lib/auth-server';
import { resolveTagNames } from '@/lib/tagNames';

/**
 * The raw leadership actions behind the overview's Leadership Performance chart — each warning
 * logged, as (actor tag, timestamp) — plus a display name for every actor. `?clanId=` scopes it.
 * Bucketing stays in the chart, which owns the granularity toggle.
 */
export async function GET(request: NextRequest) {
  try {
    // The live role check runs alongside these reads (see authorizeActiveView).
    const view = await authorizeActiveView(request, async () => {
      const clanId = request.nextUrl.searchParams.get('clanId');
      const scoped = !!clanId && clanId !== 'all';

      let warnReq = supabase
        .from('warnings')
        .select('logged_by, logged_at, player_account:player_accounts!inner(clan_id)');
      if (scoped) warnReq = warnReq.eq('player_account.clan_id', clanId);

      const warnRes = await warnReq;
      if (warnRes.error) throw warnRes.error;

      type Action = { logged_by: string | null; logged_at: string | null };
      const actions = ((warnRes.data as Action[]) || []).map((r) => ({ logged_by: r.logged_by, logged_at: r.logged_at }));
      const { loggerNames } = await resolveTagNames(actions.map((a) => a.logged_by));

      return NextResponse.json({ actions, names: loggerNames });
    });
    return view.error ?? view.data;
  } catch (error) {
    console.error('API Leadership View Error:', error);
    return NextResponse.json({ error: 'Failed to load leadership activity' }, { status: 500 });
  }
}
