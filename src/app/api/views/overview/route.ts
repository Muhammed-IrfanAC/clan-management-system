import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

/**
 * The Commander Overview's counts, in one response: members, unlinked accounts, and the strike rows
 * the page folds through the Strikes screen's own pure engine (so its numbers agree with that screen).
 * `?clanId=` scopes all three. The three reads are independent and run in parallel.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const clanId = request.nextUrl.searchParams.get('clanId');
    const scoped = !!clanId && clanId !== 'all';

    // Members = persons with an account that is not inactive, matching the registry. Scoped to a clan,
    // that is the clan's linked non-inactive accounts.
    const membersReq = scoped
      ? supabase
          .from('player_accounts')
          .select('person_id', { count: 'exact', head: true })
          .eq('clan_id', clanId)
          .neq('status', 'inactive')
          .not('person_id', 'is', null)
      : supabase
          .from('persons')
          .select('id, player_accounts!inner(status)', { count: 'exact', head: true })
          .neq('player_accounts.status', 'inactive');

    let unlinkedReq = supabase
      .from('player_accounts')
      .select('*', { count: 'exact', head: true })
      .is('person_id', null)
      .eq('status', 'active');
    if (scoped) unlinkedReq = unlinkedReq.eq('clan_id', clanId);

    let strikeReq = supabase
      .from('strikes')
      .select('person_id, player_account_tag, issued_at, leadership_approved, clan_id, person:persons(id, display_name), player_account:player_accounts(in_game_name)');
    if (scoped) strikeReq = strikeReq.eq('clan_id', clanId);

    const [membersRes, unlinkedRes, strikesRes] = await Promise.all([membersReq, unlinkedReq, strikeReq]);
    const failed = [membersRes, unlinkedRes, strikesRes].find((r) => r.error);
    if (failed?.error) throw failed.error;

    return NextResponse.json({
      totalMembers: membersRes.count || 0,
      unlinkedAccounts: unlinkedRes.count || 0,
      strikes: strikesRes.data || [],
    });
  } catch (error) {
    console.error('API Overview View Error:', error);
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 });
  }
}
