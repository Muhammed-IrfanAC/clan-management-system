import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

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
