import { NextResponse, NextRequest } from 'next/server';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';
import { syncTownHallRoles } from '@/lib/members/thRoleSync';

// The pass spends up to 25s on Discord writes, after its reads.
export const maxDuration = 60;

/**
 * POST /api/discord/th-roles — run the TH role pass now instead of waiting for the daily one. Skips
 * the once-a-day gate but not the claim, so it cannot race a sync's pass. Gated on `leader.manage`,
 * like the rest of the Discord configuration.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    await requireCapability(auth, 'leader.manage');
    const result = await syncTownHallRoles({ force: true });
    return 'skipped' in result ? NextResponse.json({ error: `Not run: ${result.skipped}` }, { status: 409 }) : NextResponse.json(result);
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
