import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';
import { botConfigured, discordBotRequest, normalizeChannelId } from '@/lib/discord';

/**
 * Verify the bot can see every channel it has been pointed at — the cutover checklist.
 *
 * A channel id the bot cannot read is a silent hole: the step resolves to it, every send into it fails, and fail-safe sending swallows the failure. So the
 * settings card offers this one-click check before a leader trusts the new routing. It reads each
 * channel (GET /channels/:id) and reports its name, or why it could not; it does NOT post anything,
 * so it cannot prove Send Messages — the result says "visible", not "deliverable".
 */

type Check = { label: string; channelId: string; ok: boolean; name?: string; error?: string };

const PURPOSE_KEYS: [string, string][] = [
  ['Override', 'discord_override_channel_id'],
  ['Announcement', 'discord_announcement_channel_id'],
  ['Leadership', 'discord_leadership_channel_id'],
  ['Unlinked-join', 'discord_unlinked_channel_id'],
];

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    await requireCapability(auth, 'leader.manage');

    if (!botConfigured()) {
      return NextResponse.json({ error: 'DISCORD_BOT_TOKEN is not set in this environment' }, { status: 400 });
    }

    const [{ data: settings }, { data: clans }] = await Promise.all([
      supabase.from('settings').select('key, value').in('key', PURPOSE_KEYS.map(([, k]) => k)),
      supabase.from('clans').select('display_name, discord_channel_id, discord_join_channel_id').eq('active', true).order('display_order'),
    ]);
    const byKey = new Map((settings || []).map((r: { key: string; value: unknown }) => [r.key, r.value]));

    const targets: { label: string; channelId: string }[] = [];
    for (const [label, key] of PURPOSE_KEYS) {
      const id = normalizeChannelId(typeof byKey.get(key) === 'string' ? (byKey.get(key) as string) : null);
      if (id) targets.push({ label, channelId: id });
    }
    type ClanRow = { display_name: string; discord_channel_id: string | null; discord_join_channel_id: string | null };
    for (const c of (clans || []) as ClanRow[]) {
      const id = normalizeChannelId(c.discord_channel_id);
      if (id) targets.push({ label: c.display_name, channelId: id });
      const join = normalizeChannelId(c.discord_join_channel_id);
      if (join) targets.push({ label: `${c.display_name} · join alerts`, channelId: join });
    }
    const fallback = normalizeChannelId(process.env.DISCORD_DEFAULT_CHANNEL_ID);
    if (fallback) targets.push({ label: 'Family-wide fallback', channelId: fallback });

    const me = (await discordBotRequest('GET', '/users/@me')) as { username?: string } | null;
    const checks: Check[] = await Promise.all(
      targets.map(async (t) => {
        const channel = (await discordBotRequest('GET', `/channels/${t.channelId}`)) as { name?: string } | null;
        return channel
          ? { ...t, ok: true, name: channel.name }
          : { ...t, ok: false, error: 'Not visible to the bot — check it is in the server and can view this channel' };
      }),
    );

    return NextResponse.json({ bot: me?.username ?? null, checks });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
