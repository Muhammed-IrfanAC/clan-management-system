import { NextResponse, NextRequest } from 'next/server';
import { authorizeActiveView } from '@/lib/auth-server';
import { loadPlannerData } from '@/lib/cwl/plannerLoad';

/**
 * One clan's war-planner rows for one season (`?season=&clan=`) — exactly what the Discord lineup
 * post plans from, since both read through `loadPlannerData`. The plan itself is derived in the
 * browser (`components/cwl/planner/usePlan.ts`); only its inputs travel. `optedOut` is a Set on the
 * server and an array on the wire.
 */
export async function GET(request: NextRequest) {
  try {
    const seasonId = request.nextUrl.searchParams.get('season');
    const clanId = request.nextUrl.searchParams.get('clan');
    if (!seasonId || !clanId) return NextResponse.json({ error: 'season and clan are required' }, { status: 400 });

    // The live role check runs alongside these reads (see authorizeActiveView).
    const view = await authorizeActiveView(request, async () => {
      const data = await loadPlannerData(seasonId, clanId);
      return NextResponse.json({ ...data, optedOut: [...data.optedOut] });
    });
    return view.error ?? view.data;
  } catch (error) {
    console.error('API CWL Planner View Error:', error);
    return NextResponse.json({ error: 'Failed to load the planner' }, { status: 500 });
  }
}
