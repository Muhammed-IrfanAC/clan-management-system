import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { postSeasonRoster, postTransferCall } from '@/lib/cwl/rosterPostNotify';
import type { CWLSeasonStatus } from '@/types/database';

const STATUSES: CWLSeasonStatus[] = ['planning', 'transfers_pending', 'signed_up', 'in_progress', 'completed'];

/** Update a season's label or advance its status (planning → … → completed). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const patch: { label?: string; status?: CWLSeasonStatus } = {};
    if (typeof body.label === 'string' && body.label.trim()) patch.label = body.label.trim();
    if (typeof body.status === 'string') {
      if (!STATUSES.includes(body.status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      patch.status = body.status;
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

    // Read the status BEFORE the write so the Discord announcements below fire on a real transition
    // rather than on every save of an unchanged status.
    const before = patch.status
      ? (await supabase.from('cwl_seasons').select('status').eq('id', id).maybeSingle()).data
      : null;

    const { error } = await supabase.from('cwl_seasons').update(patch).eq('id', id);
    if (error) throw error;

    if (patch.status && patch.status !== before?.status) await announceStatus(id, patch.status);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Announce a season status transition on Discord. Two statuses mean something to the family:
 *
 *   transfers_pending → the roster is settled enough to ask people to move. Pings the movers, and
 *                       only the first time (postTransferCall's `auto` guard), so flipping the status
 *                       back and forth cannot re-ping the family.
 *   signed_up         → the roster is final. Posts each clan's roster + the leadership digest, or
 *                       updates them if they already exist.
 *
 * Best-effort and deliberately swallowed: the status change is the user's action and it has already
 * succeeded by this point. A Discord outage must not report that back as a failed status update —
 * the leader can re-post from the roster board.
 */
async function announceStatus(seasonId: string, status: CWLSeasonStatus): Promise<void> {
  try {
    if (status === 'transfers_pending') await postTransferCall(seasonId, { auto: true });
    else if (status === 'signed_up') await postSeasonRoster(seasonId);
  } catch (err) {
    console.error(`CWL status announcement failed for season ${seasonId} (non-fatal):`, err);
  }
}

/** Delete a season. Season clans, allocations and transfers cascade via FK ON DELETE CASCADE. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { error } = await supabase.from('cwl_seasons').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
