import { NextResponse, NextRequest } from 'next/server';
import { authorizeActive } from '@/lib/auth-server';
import { postLineup, previewLineupPost } from '@/lib/cwl/nextLineupPostNotify';

/**
 * Posting a clan's next-war lineup to Discord (the planner page's button).
 *
 * GET  ?clanId=&ping=1 — preview: the exact message POST would send. Sends nothing.
 * POST { clanId, ping } — post it to the clan's channel, or update the one already posted for this war.
 *
 * Outward-facing, so the UI previews before calling POST. Gated like every other CWL route.
 */
function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'Request failed' }, { status: 500 });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const clanId = request.nextUrl.searchParams.get('clanId');
    if (!clanId) return NextResponse.json({ error: 'clanId is required' }, { status: 400 });
    const ping = request.nextUrl.searchParams.get('ping') !== '0';
    return NextResponse.json({ preview: await previewLineupPost(id, clanId, ping) });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    if (typeof body?.clanId !== 'string' || !body.clanId) {
      return NextResponse.json({ error: 'clanId is required' }, { status: 400 });
    }
    const result = await postLineup(id, body.clanId, body.ping !== false);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.roundNumber == null ? 'Every war has started — nothing to post' : 'Discord did not accept the message — check the clan webhook' },
        { status: 502 },
      );
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return failure(error);
  }
}
