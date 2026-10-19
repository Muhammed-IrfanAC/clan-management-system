import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';
import { botConfigured, invalidateDiscordRouteCache, normalizeChannelId } from '@/lib/discord';

/**
 * Configure Discord channel routing: the NOTIFICATION ROUTING OVERRIDE (migration 027) — the
 * testing-phase switch that sends every notification to one private channel instead of the per-clan
 * channels — the ANNOUNCEMENT channel (migration 029) that CWL roster posts go to, and the LEADERSHIP
 * channel (migration 035) that leadership-only alerts go to, and the UNLINKED-JOIN channel (migration
 * 036) that the unlinked-player join alert goes to. Each is a bot channel id (migration 037).
 *
 * A route rather than the General tab's direct PostgREST writes because these keys belong to one
 * control (the store filters them out of the settings blob), each id must parse before it is stored —
 * a stored id Discord rejects would silently send that route's traffic nowhere — and every write must
 * drop the transport's routing cache. Gated on `leader.manage`, the same capability that governs the
 * rest of system configuration.
 */

const ENABLED_KEY = 'discord_override_enabled';

// Bot channel ids (migration 037), keyed by the request field that writes each one.
const CHANNEL_KEYS = {
  overrideChannelId: 'discord_override_channel_id',
  announcementChannelId: 'discord_announcement_channel_id',
  leadershipChannelId: 'discord_leadership_channel_id',
  unlinkedChannelId: 'discord_unlinked_channel_id',
} as const;

async function readState() {
  const { data } = await supabase
    .from('settings')
    .select('key, value')
    .in('key', [ENABLED_KEY, ...Object.values(CHANNEL_KEYS)]);
  const rows = new Map((data || []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const str = (key: string) => (typeof rows.get(key) === 'string' ? (rows.get(key) as string) : '');
  return {
    enabled: rows.get(ENABLED_KEY) === true,
    // Whether the bot can post at all here; without it nothing is sent, whatever is configured.
    botConfigured: botConfigured(),
    // Null is a meaningful state, not an error: an unset purpose channel inherits the next step.
    overrideChannelId: normalizeChannelId(str(CHANNEL_KEYS.overrideChannelId)),
    announcementChannelId: normalizeChannelId(str(CHANNEL_KEYS.announcementChannelId)),
    leadershipChannelId: normalizeChannelId(str(CHANNEL_KEYS.leadershipChannelId)),
    unlinkedChannelId: normalizeChannelId(str(CHANNEL_KEYS.unlinkedChannelId)),
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    await requireCapability(auth, 'leader.manage');
    return NextResponse.json(await readState());
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    await requireCapability(auth, 'leader.manage');

    const body = await request.json();

    // Blank clears a channel id, handing that route to the next step of the chain. Anything else must
    // parse as one: a stored id Discord rejects would silently send that route's traffic nowhere.
    for (const [field, key] of Object.entries(CHANNEL_KEYS)) {
      if (typeof body?.[field] !== 'string') continue;
      const raw = (body[field] as string).trim();
      const id = normalizeChannelId(raw);
      if (raw && !id) {
        return NextResponse.json({ error: 'That is not a Discord channel id or channel link' }, { status: 400 });
      }
      const { error } = await supabase.from('settings').update({ value: id ?? '' }).eq('key', key);
      if (error) throw error;
    }

    if (typeof body?.enabled === 'boolean') {
      // Refuse to switch on with nowhere to send: silently falling back to normal per-clan routing is
      // the exact failure a testing phase cannot afford, since it would post to the real channels.
      if (body.enabled) {
        // Read AFTER the write above, so enabling and setting the channel in one request works.
        // A channel id only counts while the bot can use it.
        const state = await readState();
        if (!state.botConfigured || !state.overrideChannelId) {
          return NextResponse.json({ error: 'Set the override channel before turning the redirect on' }, { status: 400 });
        }
      }
      const { error } = await supabase.from('settings').update({ value: body.enabled }).eq('key', ENABLED_KEY);
      if (error) throw error;
    }

    // Every send consults a 15s cache; this instance must see the change on the very next message.
    invalidateDiscordRouteCache();

    return NextResponse.json(await readState());
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
