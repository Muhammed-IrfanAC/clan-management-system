import { NextResponse, NextRequest } from 'next/server';
import { authorizeActive } from '@/lib/auth-server';
import { postSeasonRoster, postTransferCall, renderSeasonPosts } from '@/lib/cwl/rosterPostNotify';

/**
 * Publishing a finalized CWL roster to Discord.
 *
 * GET  — preview. Returns the exact messages POST would send, so the dashboard can show a leader
 *        what the family is about to receive before it receives it. Sends nothing.
 * POST — publish. `target: 'roster'` posts/updates each clan's roster plus the leadership digest;
 *        `target: 'transfers'` sends the move call-to-action, which is the one that pings people.
 *
 * Gated on `authorizeActive` like every other CWL route: forming and announcing the roster is normal
 * co-leader work, not system configuration. Note this is an OUTWARD-FACING action — the UI confirms
 * with a preview before calling POST.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const posts = await renderSeasonPosts(id);
    return NextResponse.json({ posts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    const target = body?.target === 'transfers' ? 'transfers' : 'roster';

    const result = target === 'transfers' ? await postTransferCall(id) : await postSeasonRoster(id);

    // A send failure is reported, not thrown: some clans may have posted fine and the leader needs to
    // know which ones did not rather than being told the whole action failed.
    return NextResponse.json({ target, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
