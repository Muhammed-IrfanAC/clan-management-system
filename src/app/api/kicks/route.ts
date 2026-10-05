import { NextResponse, NextRequest } from 'next/server';
import { authorizeActive } from '@/lib/auth-server';
import { KickListError, loadKickList, loadRecentDepartures, markKicked } from '@/lib/kicks/kickList';

/**
 * The kick list. Every dashboard user (co-leaders included) may read it, add to it, edit comments and
 * remove entries — it is shared leadership knowledge, not a privileged action. The leadership-alt
 * exclusion is enforced in `markKicked`, not here.
 */

// GET: the list (with the alts each kick watches and who is in a family clan right now), plus the
// recent departures offered as "was that a kick?" suggestions.
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;
    const [entries, departures] = await Promise.all([loadKickList(), loadRecentDepartures()]);
    return NextResponse.json({ entries, departures });
  } catch (error) {
    console.error('API Kick List Error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST { playerTag, comment? }: put an account on the list. Returns the new entry.
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;
    const { playerTag, comment } = await request.json().catch(() => ({}));
    if (typeof playerTag !== 'string' || !playerTag.trim()) {
      return NextResponse.json({ error: 'playerTag is required' }, { status: 400 });
    }
    const entry = await markKicked({ rawTag: playerTag, comment: typeof comment === 'string' ? comment : null, actorTag: auth.actorTag });
    return NextResponse.json(entry);
  } catch (error) {
    if (error instanceof KickListError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('API Kick List Error:', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
