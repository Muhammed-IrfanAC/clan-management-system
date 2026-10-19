/**
 * Where a message goes.
 *
 * Every destination is a channel the bot posts to (DISCORD_BOT_TOKEN). Each clan may have its own
 * channel so events post to a clan-specific channel; when a clan has none, we fall back to the
 * family-wide channel (DISCORD_DEFAULT_CHANNEL_ID).
 *
 * PURPOSE (migration 029): the second routing axis. Most messages are addressed to particular people
 * and belong in the clan channel they already read; an ANNOUNCEMENT (the CWL roster) is addressed to
 * nobody in particular and belongs in the announcement channel. A blank announcement setting simply
 * inherits the clan channel, so the axis costs nothing until it is configured. A third purpose,
 * LEADERSHIP (migration 035), carries alerts meant for leadership only — a kicked player rejoining —
 * under the same blank-inherits rule. A fourth, UNLINKED (migration 036), carries the unlinked-player
 * join alert; blank, it inherits the leadership channel before the clan channel. A clan may route its
 * own unlinked-join alerts to a dedicated channel or thread (`clans.discord_join_channel_id`,
 * migration 039), which wins over the family-wide one — so each clan's joiners can be triaged apart.
 *
 * Webhooks (migrations 013–036) were retired once every channel moved to the bot (037, 038): a step
 * with no channel id falls through to the next, and without the bot token nothing is sent at all.
 *
 * ROUTING OVERRIDE (migration 027): while `discord_override_enabled` is on, every message is
 * redirected to the override destination. That redirect is applied by the transport at send time,
 * not here, so it covers every path — see transport.ts.
 */

import { supabase } from '@/lib/supabase';
import { normalizeChannelId } from './format';
import type { ChannelPurpose, Destination } from './types';

/** Whether the bot transport is available in this environment. */
export function botConfigured(): boolean {
  return !!process.env.DISCORD_BOT_TOKEN?.trim();
}

/** One step of the routing chain: its channel, when the bot can post there, else nothing. */
export function pickDestination(channelId: string | null | undefined, bot = botConfigured()): Destination | null {
  const id = normalizeChannelId(channelId);
  return bot && id ? { channelId: id } : null;
}

/**
 * The settings-driven routing config, cached in-process for a short TTL.
 *
 * Two rows drive the override (migration 027) rather than one: the switch and the destination are
 * separate so the channel can stay configured while the redirect is flipped off, which is what makes
 * turning the testing phase on and off a one-click action. The switch must be on and a destination
 * present for it to apply. Further rows hold the announcement channel (migration 029), the leadership
 * channel (035) and the unlinked-join channel (036), each as a bot channel id (037).
 *
 * Cached because EVERY notification consults it and a sync can fire dozens in one pass — and read in
 * ONE query, so adding the purpose axis did not add a round trip per message. The TTL is the same 15s
 * the capability loader uses: a settings flip takes effect within a sync or two, the right
 * granularity for channel routing. Fail-safe: any DB error resolves to "nothing configured", so a
 * settings-table problem degrades to normal per-clan routing rather than to silence.
 */
type RouteConfig = {
  overrideEnabled: boolean;
  override: string | null;
  announcement: string | null;
  leadership: string | null;
  unlinked: string | null;
};
let routeCache: { config: RouteConfig; at: number } | null = null;
const OVERRIDE_TTL_MS = 15_000;

export const ROUTE_SETTING_KEYS = [
  'discord_override_enabled',
  'discord_override_channel_id',
  'discord_announcement_channel_id',
  'discord_leadership_channel_id',
  'discord_unlinked_channel_id',
] as const;

async function routeConfig(): Promise<RouteConfig> {
  const now = Date.now();
  if (routeCache && now - routeCache.at < OVERRIDE_TTL_MS) return routeCache.config;

  let config: RouteConfig = {
    overrideEnabled: false,
    override: null,
    announcement: null,
    leadership: null,
    unlinked: null,
  };
  try {
    const { data } = await supabase.from('settings').select('key, value').in('key', [...ROUTE_SETTING_KEYS]);
    const rows = new Map((data || []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
    const str = (key: string) => (typeof rows.get(key) === 'string' ? (rows.get(key) as string).trim() : '');
    const hop = (name: string) => str(`discord_${name}_channel_id`) || null;

    config = {
      overrideEnabled: rows.get('discord_override_enabled') === true,
      override: hop('override'),
      announcement: hop('announcement'),
      leadership: hop('leadership'),
      unlinked: hop('unlinked'),
    };
  } catch (err) {
    console.error('Discord routing lookup failed (falling back to normal routing):', err);
  }

  routeCache = { config, at: now };
  return config;
}

/** The test-routing destination while the override is on, else null. Consulted by the transport. */
export async function overrideDestination(): Promise<Destination | null> {
  const config = await routeConfig();
  return config.overrideEnabled ? pickDestination(config.override) : null;
}

/** Drop the cached routing so the next send re-reads the settings rows. Called after a config write. */
export function invalidateDiscordRouteCache(): void {
  routeCache = null;
}

/**
 * The last step of every chain: the family-wide channel (DISCORD_DEFAULT_CHANNEL_ID), or nothing
 * (feature disabled).
 */
export function fallbackDestination(): Destination | null {
  return pickDestination(process.env.DISCORD_DEFAULT_CHANNEL_ID);
}

/**
 * Resolve where a message goes: the announcement or leadership channel when that is what this is
 * and one is set, else the clan's own channel, else the family-wide fallback. Returns null when
 * nothing is configured anywhere (feature disabled).
 *
 * The chain FALLS THROUGH rather than branching, so an unconfigured announcement channel is not a
 * dead end — it means "announcements have no home of their own yet", and they keep landing exactly
 * where they did before the purpose axis existed.
 *
 * This resolves the NORMAL destination and deliberately ignores the routing override — the redirect
 * is applied at send time so it covers every path, not only the ones that call this.
 */
export async function destinationForClan(
  clanId?: string | null,
  purpose: ChannelPurpose = 'default',
): Promise<Destination | null> {
  if (purpose === 'unlinked' && clanId) {
    // A thread id works here too: Discord posts into a thread exactly as into a channel.
    const { data } = await supabase.from('clans').select('discord_join_channel_id').eq('id', clanId).maybeSingle();
    const own = pickDestination(data?.discord_join_channel_id);
    if (own) return own;
  }
  if (purpose !== 'default') {
    const config = await routeConfig();
    const dedicated =
      purpose === 'announcement'
        ? pickDestination(config.announcement)
        : purpose === 'unlinked'
          ? pickDestination(config.unlinked) || pickDestination(config.leadership)
          : pickDestination(config.leadership);
    if (dedicated) return dedicated;
  }
  if (clanId) {
    const { data } = await supabase.from('clans').select('discord_channel_id').eq('id', clanId).maybeSingle();
    const clan = pickDestination(data?.discord_channel_id);
    if (clan) return clan;
  }
  return fallbackDestination();
}
