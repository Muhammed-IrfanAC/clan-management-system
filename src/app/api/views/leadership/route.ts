import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { resolveTagNames } from '@/lib/tagNames';

/**
 * The raw leadership actions behind the overview's Leadership Performance chart — each warning
 * logged and each leadership log recorded, as (actor tag, timestamp) — plus a display name for every
 * actor. `?clanId=` scopes both. Bucketing stays in the chart, which owns the granularity toggle.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const clanId = request.nextUrl.searchParams.get('clanId');
    const scoped = !!clanId && clanId !== 'all';

    let warnReq = supabase
      .from('warnings')
      .select('logged_by, logged_at, player_account:player_accounts!inner(clan_id)');
    if (scoped) warnReq = warnReq.eq('player_account.clan_id', clanId);

    let logReq = supabase.from('leadership_logs').select('logged_by, logged_at, clan_id');
    if (scoped) logReq = logReq.eq('clan_id', clanId);

    const [warnRes, logRes] = await Promise.all([warnReq, logReq]);
    if (warnRes.error) throw warnRes.error;
    if (logRes.error) throw logRes.error;

    type Action = { logged_by: string | null; logged_at: string | null };
    const actions = [...((warnRes.data as Action[]) || []), ...((logRes.data as Action[]) || [])]
      .map((r) => ({ logged_by: r.logged_by, logged_at: r.logged_at }));
    const { loggerNames } = await resolveTagNames(actions.map((a) => a.logged_by));

    return NextResponse.json({ actions, names: loggerNames });
  } catch (error) {
    console.error('API Leadership View Error:', error);
    return NextResponse.json({ error: 'Failed to load leadership activity' }, { status: 500 });
  }
}
