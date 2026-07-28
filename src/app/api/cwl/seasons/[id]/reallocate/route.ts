import { NextResponse, NextRequest } from 'next/server';
import { authorizeActive } from '@/lib/auth-server';
import { generateAllocation } from '@/lib/cwl/generate';

/**
 * Re-run the allocation engine for an existing season.
 *
 * The counterpart to rearranging the clan priority order (PATCH .../clans): changing the order is
 * only meaningful if the roster can be regenerated against it. Also picks up roster drift since the
 * season was created — new recruits, TH upgrades, league movement, and accounts that have since
 * become war-ineligible through the Strike system.
 *
 * DESTRUCTIVE: the season's existing allocations and their transfer records are replaced wholesale,
 * so any leader hand-edits are lost. The UI confirms before calling this. The season's FROZEN
 * constraints are reused unchanged — a re-allocation re-applies the season's rules, it does not
 * redefine them.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { allocated } = await generateAllocation(id);
    return NextResponse.json({ success: true, allocated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
