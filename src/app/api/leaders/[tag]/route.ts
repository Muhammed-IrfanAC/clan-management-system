import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse, AuthError } from '@/lib/auth-server';
import { canAssignRole } from '@/lib/permissions';
import { AccessRole } from '@/types/database';

/**
 * Grant, change, or revoke a person's dashboard access, addressed by one of their account tags.
 * Access is a property of the PERSON, so this writes persons.access_role — every linked alt of that
 * person inherits the grant (or the revoke) at once.
 *
 * Body: { access_role: AccessRole | null }  — a role grants/sets it; null revokes access entirely.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tag: string }> }) {
  try {
    const { tag } = await params;
    const decodedTag = decodeURIComponent(tag);
    const auth = await requireAuth(request);
    const actorRole = await requireCapability(auth, 'leader.manage');

    const body = await request.json();
    // Accept `access_role` (new); tolerate a bare null to mean "revoke".
    const nextRole: AccessRole | null = (body?.access_role ?? null) as AccessRole | null;

    // Resolve the account → its person (permission lives on the person, not the account).
    const { data: account } = await supabase
      .from('player_accounts')
      .select('person_id, person:persons(access_role)')
      .eq('player_tag', decodedTag)
      .maybeSingle();
    if (!account?.person_id) {
      return NextResponse.json({ error: 'Account is not linked to a person' }, { status: 404 });
    }
    const currentRole =
      (account as { person?: { access_role?: AccessRole | null } | null }).person?.access_role ?? null;

    // Guardrail: the single super_admin (owner) can only be touched by a super_admin — a leader must
    // never demote or lock out the owner.
    if (currentRole === 'super_admin' && actorRole !== 'super_admin') {
      throw new AuthError('Only a super admin can modify the owner account', 403);
    }

    // The role in question — the one being granted, or (for a revoke) the one being removed — must be
    // within the actor's assignment power. This makes revoke symmetric with grant: a leader can lift
    // access they could have granted (co_leaders), but cannot revoke a fellow leader; super_admin can.
    const roleInQuestion = nextRole ?? currentRole;
    if (roleInQuestion && !canAssignRole(actorRole, roleInQuestion)) {
      throw new AuthError('You are not allowed to change access at that level', 403);
    }

    const { error } = await supabase
      .from('persons')
      .update({ access_role: nextRole })
      .eq('id', account.person_id);
    if (error) throw error;

    return NextResponse.json({ success: true, person_id: account.person_id, access_role: nextRole });
  } catch (error: any) {
    return authErrorResponse(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }
}
