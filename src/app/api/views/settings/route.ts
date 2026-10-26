import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { ROUTE_SETTING_KEYS } from '@/lib/discord/routing';

/**
 * Every server slice the Settings screen loads, in one response and one parallel round of reads:
 * the generic settings (minus the Discord routing keys, which /api/settings/discord-route serves and
 * validates), clans, rules, and the account rows behind the Leaders tab — access holders, and the
 * persons who could be granted access. The store collapses those rows to one per person.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const [settingsRes, clansRes, rulesRes, leadersRes, candidatesRes] = await Promise.all([
      supabase
        .from('settings')
        .select('*')
        .not('key', 'in', `(${ROUTE_SETTING_KEYS.join(',')})`),
      supabase.from('clans').select('*').order('display_order'),
      supabase.from('rules').select('*'),
      // Access-holders = persons with a non-null access_role, addressed via a representative account.
      supabase
        .from('player_accounts')
        .select('player_tag, is_main_account, person_id, person:persons!inner(access_role, display_name)')
        .not('person.access_role', 'is', null),
      // Candidates for "Add Leader": persons without access. A person whose every account is
      // inactive has left the family, so is not a candidate.
      supabase
        .from('player_accounts')
        .select('player_tag, is_main_account, person_id, person:persons!inner(access_role, display_name)')
        .is('person.access_role', null)
        .neq('status', 'inactive'),
    ]);
    const failed = [settingsRes, clansRes, rulesRes, leadersRes, candidatesRes].find((r) => r.error);
    if (failed?.error) throw failed.error;

    return NextResponse.json({
      settings: settingsRes.data || [],
      clans: clansRes.data || [],
      rules: rulesRes.data || [],
      leaderAccounts: leadersRes.data || [],
      candidateAccounts: candidatesRes.data || [],
    });
  } catch (error) {
    console.error('API Settings View Error:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}
