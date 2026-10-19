import { NextResponse, NextRequest } from 'next/server';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';
import { syncCommands } from '@/lib/discord/interactions/register';

/**
 * POST /api/discord/commands — push the slash-command definitions to Discord. Run once after setup
 * and after any change to `lib/discord/interactions/commands/definitions.ts`. Gated on
 * `leader.manage`, like the rest of the Discord configuration.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    await requireCapability(auth, 'leader.manage');
    const result = await syncCommands();
    return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: 400 });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
