/**
 * Where a message goes.
 *
 * Each clan may have its own channel so events post to a clan-specific channel; when a clan has
 * none, we fall back to the family-wide channel (DISCORD_DEFAULT_CHANNEL_ID / DISCORD_WEBHOOK_URL).
 *
 * PURPOSE (migration 029): the second routing axis. Most messages are addressed to particular people
 * and belong in the clan channel they already read; an ANNOUNCEMENT (the CWL roster) is addressed to
 * nobody in particular and belongs in the announcement channel. A blank announcement setting simply
 * inherits the clan channel, so the axis costs nothing until it is configured. A third purpose,
 * LEADERSHIP (migration 035), carries alerts meant for leadership only — a kicked player rejoining —
 * under the same blank-inherits rule. A fourth, UNLINKED (migration 036), carries the unlinked-player
 * join alert; blank, it inherits the leadership channel before the clan channel.
 *
 * BOT vs WEBHOOK (migration 037): every step of the chain holds a channel id beside its webhook. With
 * DISCORD_BOT_TOKEN set, a step that has a channel id resolves to that channel; otherwise the step's
 * webhook is used, and only a step with neither falls through to the next. That makes the cutover
 * per channel — and removing the token puts the whole family back on webhooks with nothing to undo.
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

/** One step of the routing chain: a channel id and/or a webhook, either possibly unset. */
type Hop = { channelId: string | null; webhookUrl: string | null };

/** The step's destination: its channel when the bot can post there, else its webhook, else nothing. */
export function pickDestination(hop: Hop, bot = botConfigured()): Destination | null {
  const channelId = normalizeChannelId(hop.channelId);
  if (bot && channelId) return { kind: 'channel', channelId };
  const url = hop.webhookUrl?.trim();
  return url ? { kind: 'webhook', url } : null;
}

/**
 * The settings-driven routing config, cached in-process for a short TTL.
 *
 * Two rows drive the override (migration 027) rather than one: the switch and the destination are
 * separate so the channel can stay configured while the redirect is flipped off, which is what makes
 * turning the testing phase on and off a one-click action. The switch must be on and a destination
 * present for it to apply. Further rows hold the announcement channel (migration 029), the leadership
 * channel (035) and the unlinked-join channel (036), each as a webhook and a bot channel id (037).
 *
 * Cached because EVERY notification consults it and a sync can fire dozens in one pass — and read in
 * ONE query, so adding the purpose axis did not add a round trip per message. The TTL is the same 15s
 * the capability loader uses: a settings flip takes effect within a sync or two, the right
 * granularity for channel routing. Fail-safe: any DB error resolves to "nothing configured", so a
 * settings-table problem degrades to normal per-clan routing rather than to silence.
 */
type RouteConfig = {
  overrideEnabled: boolean;
  override: Hop;
  announcement: Hop;
  leadership: Hop;
  unlinked: Hop;
};
let routeCache: { config: RouteConfig; at: number } | null = null;
const OVERRIDE_TTL_MS = 15_000;

const EMPTY_HOP: Hop = { channelId: null, webhookUrl: null };

export const ROUTE_SETTING_KEYS = [
  'discord_override_enabled',
  'discord_override_webhook_url',
  'discord_override_channel_id',
  'discord_announcement_webhook_url',
  'discord_announcement_channel_id',
  'discord_leadership_webhook_url',
  'discord_leadership_channel_id',
  'discord_unlinked_webhook_url',
  'discord_unlinked_channel_id',
] as const;

async function routeConfig(): Promise<RouteConfig> {
  const now = Date.now();
  if (routeCache && now - routeCache.at < OVERRIDE_TTL_MS) return routeCache.config;

  let config: RouteConfig = {
    overrideEnabled: false,
    override: EMPTY_HOP,
    announcement: EMPTY_HOP,
    leadership: EMPTY_HOP,
    unlinked: EMPTY_HOP,
  };
  try {
    const { data } = await supabase.from('settings').select('key, value').in('key', [...ROUTE_SETTING_KEYS]);
    const rows = new Map((data || []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
    const str = (key: string) => (typeof rows.get(key) === 'string' ? (rows.get(key) as string).trim() : '');
    const hop = (name: string): Hop => ({
      channelId: str(`discord_${name}_channel_id`) || null,
      webhookUrl: str(`discord_${name}_webhook_url`) || null,
    });

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
 * The last step of every chain: the family-wide channel — DISCORD_DEFAULT_CHANNEL_ID for the bot,
 * else DISCORD_WEBHOOK_URL — or nothing (feature disabled).
 */
export function fallbackDestination(): Destination | null {
  return pickDestination({
    channelId: process.env.DISCORD_DEFAULT_CHANNEL_ID || null,
    webhookUrl: process.env.DISCORD_WEBHOOK_URL || null,
  });
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
    const { data } = await supabase
      .from('clans')
      .select('discord_webhook_url, discord_channel_id')
      .eq('id', clanId)
      .maybeSingle();
    const clan = pickDestination({
      channelId: data?.discord_channel_id ?? null,
      webhookUrl: data?.discord_webhook_url ?? null,
    });
    if (clan) return clan;
  }
  return fallbackDestination();
}
