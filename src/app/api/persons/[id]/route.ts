import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive, requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';

// A Discord user id is a snowflake: a 17–20 digit decimal string. We store it as TEXT so the full
// precision survives (it overflows a JS number), and validate the shape here rather than trusting the
// client. Right-click a Discord user → "Copy User ID" (Developer Mode on) yields exactly this.
const DISCORD_ID_RE = /^\d{17,20}$/;

/**
 * PATCH /api/persons/:id — update editable person fields from the dashboard.
 *
 * Currently the only editable field is `discord_user_id`: link (or re-link) the persona to a Discord
 * account so warning webhooks can @-mention them, or pass null/'' to unlink. This replaces the
 * `scripts/link-discord.mjs` backfill for one-off edits — leaders no longer touch the DB directly.
 *
 * Any active leader may set it (same bar as recording onboarding events — it's data entry, not a
 * permission grant). One Discord id maps to at most one persona, so linking an id already held by a
 * DIFFERENT person is rejected (409) rather than silently split across two personas; alts share a
 * person, so re-linking the same id to the same person is a no-op success.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({}));

    if (!('discord_user_id' in body)) {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    // Normalise: trim, and treat blank as "unlink" (store NULL).
    const raw = body.discord_user_id;
    const trimmed = raw == null ? '' : String(raw).trim();
    const discordId = trimmed === '' ? null : trimmed;

    if (discordId !== null && !DISCORD_ID_RE.test(discordId)) {
      return NextResponse.json(
        { error: 'Discord ID must be a 17–20 digit user ID (enable Developer Mode → Copy User ID).' },
        { status: 400 }
      );
    }

    // Guard the one-id-per-person invariant: reject an id already linked to another persona.
    if (discordId !== null) {
      const { data: clash } = await supabase
        .from('persons')
        .select('id, display_name')
        .eq('discord_user_id', discordId)
        .neq('id', id)
        .maybeSingle();
      if (clash) {
        return NextResponse.json(
          { error: `That Discord ID is already linked to ${clash.display_name || 'another member'}.` },
          { status: 409 }
        );
      }
    }

    const { data, error } = await supabase
      .from('persons')
      .update({ discord_user_id: discordId })
      .eq('id', id)
      .select('id, discord_user_id')
      .single();
    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API Person Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/persons/:id — remove a person from the registry.
 *
 * Their linked accounts are DETACHED back to the Unlinked pool (player_accounts.person_id → NULL) —
 * this must happen before the delete since that FK has no ON DELETE rule, and it's the behaviour we
 * want: the in-game accounts survive, only the human record goes. Deleting the person then CASCADES
 * to their strikes, member notes and onboarding events (ON DELETE CASCADE), so this is irreversible.
 *
 * Gated on `leader.manage` (leaders + super_admin). Guardrail: a person who still holds dashboard
 * access can't be deleted — revoke their access first, mirroring the baby auto-sweep which never
 * removes an access-holder.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireAuth(request);
    await requireCapability(auth, 'leader.manage');

    const { data: person, error: readError } = await supabase
      .from('persons')
      .select('id, access_role, display_name')
      .eq('id', id)
      .maybeSingle();
    if (readError) throw readError;
    if (!person) return NextResponse.json({ error: 'Person not found' }, { status: 404 });
    if (person.access_role) {
      return NextResponse.json(
        { error: 'This person holds dashboard access. Revoke their access in Settings before deleting.' },
        { status: 409 }
      );
    }

    // Return every linked account to the Unlinked pool before removing the person.
    const { error: detachError } = await supabase
      .from('player_accounts')
      .update({ person_id: null })
      .eq('person_id', id);
    if (detachError) throw detachError;

    // Cascades to strikes / member_notes / onboarding_events via their ON DELETE CASCADE FKs.
    const { error: deleteError } = await supabase.from('persons').delete().eq('id', id);
    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API Person Delete Error:', error);
    return authErrorResponse(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }
}
