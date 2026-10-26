import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

// Persons with their non-inactive accounts. Through the inner join, a person whose every account is
// inactive drops off — they have left the family.
const MEMBER_SELECT = '*, player_accounts!inner (*, clan:clans (*))';

/**
 * The member registry: persons with their linked accounts, plus the active unlinked accounts (the
 * roster-review queue). `?clanId=` narrows the PERSON list to anyone with an account in that clan
 * (who keeps all their alts on the card) and the unlinked queue to that clan. `?personId=` instead
 * returns just that one person, which is how the store splices a fresh link in without a reload.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const params = request.nextUrl.searchParams;
    const personId = params.get('personId');
    if (personId) {
      const { data, error } = await supabase
        .from('persons')
        .select(MEMBER_SELECT)
        .neq('player_accounts.status', 'inactive')
        .eq('id', personId)
        .maybeSingle();
      if (error) throw error;
      return NextResponse.json({ person: data });
    }

    const clanId = params.get('clanId');
    const scoped = !!clanId && clanId !== 'all';
    let unlinkedReq = supabase
      .from('player_accounts')
      .select('*, clan:clans (*)')
      .is('person_id', null)
      .eq('status', 'active');
    if (scoped) unlinkedReq = unlinkedReq.eq('clan_id', clanId);

    const [personsRes, unlinkedRes] = await Promise.all([
      supabase
        .from('persons')
        .select(MEMBER_SELECT)
        .neq('player_accounts.status', 'inactive')
        .order('display_name'),
      unlinkedReq,
    ]);
    if (personsRes.error) throw personsRes.error;
    if (unlinkedRes.error) throw unlinkedRes.error;

    type MemberRow = { player_accounts: { clan_id: string | null }[] };
    let members = (personsRes.data as unknown as MemberRow[]) || [];
    if (scoped) members = members.filter((p) => p.player_accounts.some((acc) => acc.clan_id === clanId));

    return NextResponse.json({ members, unlinkedAccounts: unlinkedRes.data || [] });
  } catch (error) {
    console.error('API Members View Error:', error);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }
}
