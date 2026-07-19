import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse, authorizeActive, hasCapability } from '@/lib/auth-server';

/**
 * PATCH /api/players/:tag — currently only supports UNLINKING an account from its person
 * (body: { person_id: null }). Re-linking goes through /api/members/link, so a non-null person_id
 * is rejected here to keep this endpoint single-purpose.
 *
 * Detaching an alt is roster curation — the inverse of linking — so any active leader may do it.
 * But if this is the person's LAST account, the unlink collapses into a person deletion (their
 * profile would otherwise be an invisible, accountless orphan). That case is gated exactly like
 * DELETE /api/persons/:id — it needs `leader.manage`, refuses an access-holder — and cascades the
 * person's strikes / notes / onboarding history. This replaces a raw client-side supabase mutation
 * that bypassed auth entirely.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tag: string }> }) {
  try {
    const { tag } = await params;
    const decodedTag = decodeURIComponent(tag);
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));
    if (!('person_id' in body) || body.person_id !== null) {
      return NextResponse.json({ error: 'Only unlinking (person_id: null) is supported here' }, { status: 400 });
    }

    const { data: account, error: readError } = await supabase
      .from('player_accounts')
      .select('person_id')
      .eq('player_tag', decodedTag)
      .maybeSingle();
    if (readError) throw readError;
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    if (!account.person_id) return NextResponse.json({ success: true, deletedPerson: false });

    // Count the person's accounts: unlinking their only one turns into a full person deletion.
    const { count } = await supabase
      .from('player_accounts')
      .select('player_tag', { count: 'exact', head: true })
      .eq('person_id', account.person_id);
    const isLastAccount = (count ?? 0) <= 1;

    if (isLastAccount) {
      // Same bar as deleting the person outright.
      if (!(await hasCapability(auth.actorTag, 'leader.manage'))) {
        return NextResponse.json(
          { error: 'This is their only account — unlinking it would delete the member. That needs leader permission; ask a leader or use Delete Person.' },
          { status: 403 }
        );
      }
      const { data: person } = await supabase
        .from('persons')
        .select('access_role')
        .eq('id', account.person_id)
        .maybeSingle();
      if (person?.access_role) {
        return NextResponse.json(
          { error: 'This person holds dashboard access. Revoke their access in Settings before removing their last account.' },
          { status: 409 }
        );
      }
      // Detach then delete (cascades strikes / notes / onboarding via ON DELETE CASCADE).
      const { error: detachError } = await supabase
        .from('player_accounts')
        .update({ person_id: null })
        .eq('player_tag', decodedTag);
      if (detachError) throw detachError;
      const { error: deleteError } = await supabase.from('persons').delete().eq('id', account.person_id);
      if (deleteError) throw deleteError;
      return NextResponse.json({ success: true, deletedPerson: true });
    }

    // Person keeps other accounts: a plain detach.
    const { error: unlinkError } = await supabase
      .from('player_accounts')
      .update({ person_id: null })
      .eq('player_tag', decodedTag);
    if (unlinkError) throw unlinkError;
    return NextResponse.json({ success: true, deletedPerson: false });
  } catch (error: any) {
    return authErrorResponse(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }
}

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
