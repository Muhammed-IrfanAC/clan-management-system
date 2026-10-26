import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { resolveTagNames } from '@/lib/tagNames';

/**
 * Everything the Strikes screen loads, in one response: the strikes with their context, the
 * logger/author name lookup, the rules, the pending review queue and the active linked accounts
 * (the manual-strike picker). The independent reads run in parallel; only the name lookup waits,
 * since it is keyed by the strikes it names. The review queue is best-effort, as on the page.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const [strikesRes, rulesRes, reviewRes, accountsRes] = await Promise.all([
      supabase
        .from('strikes')
        .select(`
          *,
          person:persons (*),
          rule:rules (*),
          player_account:player_accounts (*),
          strike_violations (*),
          strike_notes (*)
        `)
        .order('issued_at', { ascending: false }),
      supabase.from('rules').select('*'),
      supabase
        .from('strike_suggestions')
        .select('*, person:persons(id, display_name), rule:rules(id, name)')
        .eq('status', 'pending')
        .order('detected_at', { ascending: false }),
      supabase
        .from('player_accounts')
        .select('*, person:persons (id, display_name)')
        .eq('status', 'active')
        .not('person_id', 'is', null)
        .order('in_game_name'),
    ]);
    if (strikesRes.error) throw strikesRes.error;
    if (reviewRes.error) console.error('Review queue load failed:', reviewRes.error);

    type StrikeRow = { logged_by: string | null; approved_by: string | null; strike_notes: { author_tag: string | null }[] | null };
    const strikes = (strikesRes.data as StrikeRow[]) || [];
    const { loggerNames, authorPersons } = await resolveTagNames(
      strikes.flatMap((s) => [s.logged_by, ...(s.strike_notes || []).map((n) => n.author_tag), s.approved_by]),
    );

    return NextResponse.json({
      strikes,
      loggerNames,
      authorPersons,
      rules: rulesRes.data || [],
      reviewItems: reviewRes.data || [],
      accounts: accountsRes.data || [],
    });
  } catch (error) {
    console.error('API Strikes View Error:', error);
    return NextResponse.json({ error: 'Failed to load strikes' }, { status: 500 });
  }
}
