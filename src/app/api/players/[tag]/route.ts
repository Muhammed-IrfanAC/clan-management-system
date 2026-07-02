import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tag: string }> }) {
  try {
    const { tag } = await params;
    const decodedTag = decodeURIComponent(tag);
    const auth = await requireAuth(request);
    await requireCapability(auth, 'account.delete');

    const { error } = await supabase.from('player_accounts').delete().eq('player_tag', decodedTag);
    if (error) throw error;

    // NOTE: We intentionally do NOT delete the linked person here, even if it now has no accounts.
    // A person is a clan-independent identity: deleting it loses their warning history (warnings
    // cascade on person delete) and prevents re-linking if the player returns to a family clan.
    // Orphaned persons are kept so they can be re-linked manually via /api/members/link.

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return authErrorResponse(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }
}
