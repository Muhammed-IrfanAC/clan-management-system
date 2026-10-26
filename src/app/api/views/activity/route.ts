import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { resolveTagNames } from '@/lib/tagNames';

/**
 * Everything the Leadership Activity screen loads, in one response: the feed (optionally one
 * clan's, `?clanId=`), the logger/author name lookup, and the clan and person option lists for the
 * add/edit form. The option lists do not depend on the feed, so they load alongside it.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const clanId = request.nextUrl.searchParams.get('clanId');
    let logsReq = supabase
      .from('leadership_logs')
      .select(`
        *,
        clan:clans (*),
        person:persons (*),
        activity_notes (*)
      `)
      .order('pinned', { ascending: false })
      .order('logged_at', { ascending: false });
    if (clanId && clanId !== 'all') logsReq = logsReq.eq('clan_id', clanId);

    const [logsRes, clansRes, personsRes] = await Promise.all([
      logsReq,
      supabase.from('clans').select('*'),
      supabase.from('persons').select('*').order('display_name'),
    ]);
    if (logsRes.error) throw logsRes.error;

    type LogRow = { logged_by: string | null; activity_notes: { author_tag: string | null }[] | null };
    const logs = (logsRes.data as LogRow[]) || [];
    const { loggerNames, authorPersons } = await resolveTagNames(
      logs.flatMap((l) => [l.logged_by, ...(l.activity_notes || []).map((n) => n.author_tag)]),
    );

    return NextResponse.json({
      logs,
      loggerNames,
      authorPersons,
      clans: clansRes.data || [],
      persons: personsRes.data || [],
    });
  } catch (error) {
    console.error('API Activity View Error:', error);
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 });
  }
}
