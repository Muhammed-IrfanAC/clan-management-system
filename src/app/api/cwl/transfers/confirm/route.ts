import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

/**
 * Confirm (or un-confirm) a required in-game transfer. The move itself happens in-game; this is the
 * leader's manual checkbox recording that it is done. Toggling drives both the transfer row and its
 * allocation's status together so the two never drift.
 *
 * Body: { transferId, done }  — done=true → transfer 'done' + allocation 'transferred';
 *                               done=false → transfer 'pending' + allocation 'transfer_required'.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { transferId, done } = await request.json();
    if (!transferId) return NextResponse.json({ error: 'transferId is required' }, { status: 400 });

    const { data: transfer, error: fetchErr } = await supabase
      .from('cwl_transfers')
      .select('id, allocation_id')
      .eq('id', transferId)
      .single();
    if (fetchErr) throw fetchErr;

    const isDone = done !== false; // default to confirming
    const { error: tErr } = await supabase
      .from('cwl_transfers')
      .update({ status: isDone ? 'done' : 'pending' })
      .eq('id', transferId);
    if (tErr) throw tErr;

    const { error: aErr } = await supabase
      .from('cwl_allocations')
      .update({ status: isDone ? 'transferred' : 'transfer_required' })
      .eq('id', transfer.allocation_id);
    if (aErr) throw aErr;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
