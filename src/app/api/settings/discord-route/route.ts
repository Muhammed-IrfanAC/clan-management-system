import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';
import { invalidateDiscordRouteCache } from '@/lib/discord';

/**
 * Configure the Discord NOTIFICATION ROUTING OVERRIDE (migration 027) — the testing-phase switch
 * that sends every notification to one private channel instead of the per-clan channels.
 *
 * Why this exists as a route at all, when the General settings tab writes every other settings row
 * straight to PostgREST from the browser: a webhook URL is a SECRET. Anyone holding it can post into
 * the channel as the bot. So it is never included in the settings blob the dashboard fetches — the
 * store filters the key out, and this route serves a MASKED form of it for display. The full value
 * is write-only from the client's perspective.
 *
 * Gated on `leader.manage`, the same capability that governs the rest of system configuration.
 */

const ENABLED_KEY = 'discord_override_enabled';
const URL_KEY = 'discord_override_webhook_url';

/** Show enough of the URL to recognise WHICH webhook is set, never enough to use it. */
function maskWebhook(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  // A Discord webhook is .../webhooks/<channel-id>/<token>. The id identifies the channel and is not
  // itself a credential; the token is the secret, so only its last few characters survive.
  const parts = trimmed.split('/');
  const token = parts.pop() || '';
  const id = parts.pop() || '';
  return `…/${id}/${'•'.repeat(8)}${token.slice(-4)}`;
}

async function readState() {
  const { data } = await supabase.from('settings').select('key, value').in('key', [ENABLED_KEY, URL_KEY]);
  const rows = new Map((data || []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
  const url = typeof rows.get(URL_KEY) === 'string' ? (rows.get(URL_KEY) as string) : '';
  return {
    enabled: rows.get(ENABLED_KEY) === true,
    maskedUrl: maskWebhook(url),
    configured: !!url.trim(),
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

    // The URL is optional on a request that only flips the switch, so "absent" and "cleared" must
    // stay distinguishable — only a present string is written.
    if (typeof body?.webhookUrl === 'string') {
      const url = body.webhookUrl.trim();
      if (url && !/^https:\/\/(canary\.|ptb\.)?discord\.com\/api\/webhooks\//.test(url)) {
        return NextResponse.json({ error: 'That is not a Discord webhook URL' }, { status: 400 });
      }
      const { error } = await supabase.from('settings').update({ value: url }).eq('key', URL_KEY);
      if (error) throw error;
    }

    if (typeof body?.enabled === 'boolean') {
      // Refuse to switch on with nowhere to send: silently falling back to normal per-clan routing is
      // the exact failure a testing phase cannot afford, since it would post to the real channels.
      if (body.enabled) {
        // Read AFTER the write above, so enabling and setting the URL in one request works.
        const { data } = await supabase.from('settings').select('value').eq('key', URL_KEY).maybeSingle();
        const configured = typeof data?.value === 'string' && data.value.trim();
        if (!configured) {
          return NextResponse.json({ error: 'Set the override webhook URL before turning the redirect on' }, { status: 400 });
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
