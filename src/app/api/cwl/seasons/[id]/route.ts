import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
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

    const { error } = await supabase.from('cwl_seasons').update(patch).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
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
