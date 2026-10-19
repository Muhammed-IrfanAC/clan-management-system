/**
 * Where a message goes.
 *
 * Each clan may have its own webhook (`clans.discord_webhook_url`) so events post to a clan-specific
 * channel; when a clan has none, we fall back to the global DISCORD_WEBHOOK_URL env var.
 *
 * PURPOSE (migration 029): the second routing axis. Most messages are addressed to particular people
 * and belong in the clan channel they already read; an ANNOUNCEMENT (the CWL roster) is addressed to
 * nobody in particular and belongs in the announcement channel. A blank announcement setting simply
 * inherits the clan channel, so the axis costs nothing until it is configured. A third purpose,
 * LEADERSHIP (migration 035), carries alerts meant for leadership only — a kicked player rejoining —
 * under the same blank-inherits rule. A fourth, UNLINKED (migration 036), carries the unlinked-player
 * join alert; blank, it inherits the leadership channel before the clan channel.
 *
 * ROUTING OVERRIDE (migration 027): while `discord_override_enabled` is on, every message is
 * redirected to `discord_override_webhook_url`. That redirect is applied by the transport at send
 * time, not here, so it covers every path — see transport.ts.
 */

import { supabase } from '@/lib/supabase';
import type { ChannelPurpose } from './types';

/**
 * The settings-driven routing config, cached in-process for a short TTL.
 *
 * Two rows drive the override (migration 027) rather than one: the switch and the destination are
 * separate so the channel can stay configured while the redirect is flipped off, which is what makes
 * turning the testing phase on and off a one-click action. Both must be present for it to apply.
 * Further rows hold the announcement channel (migration 029), the leadership channel (035) and the
 * unlinked-join channel (036).
 *
 * Cached because EVERY notification consults it and a sync can fire dozens in one pass — and read in
 * ONE query, so adding the purpose axis did not add a round trip per message. The TTL is the same 15s
 * the capability loader uses: a settings flip takes effect within a sync or two, the right
 * granularity for channel routing. Fail-safe: any DB error resolves to "nothing configured", so a
 * settings-table problem degrades to normal per-clan routing rather than to silence.
 */
type RouteConfig = {
  override: string | null;
  announcement: string | null;
  leadership: string | null;
  unlinked: string | null;
};
let routeCache: { config: RouteConfig; at: number } | null = null;
const OVERRIDE_TTL_MS = 15_000;

async function routeConfig(): Promise<RouteConfig> {
  const now = Date.now();
  if (routeCache && now - routeCache.at < OVERRIDE_TTL_MS) return routeCache.config;

  let config: RouteConfig = { override: null, announcement: null, leadership: null, unlinked: null };
  try {
    const { data } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', [
        'discord_override_enabled',
        'discord_override_webhook_url',
        'discord_announcement_webhook_url',
        'discord_leadership_webhook_url',
        'discord_unlinked_webhook_url',
      ]);
    const rows = new Map((data || []).map((r: { key: string; value: unknown }) => [r.key, r.value]));
    const str = (key: string) => (typeof rows.get(key) === 'string' ? (rows.get(key) as string).trim() : '');

    const enabled = rows.get('discord_override_enabled') === true;
    const overrideUrl = str('discord_override_webhook_url');
    config = {
      override: enabled && overrideUrl ? overrideUrl : null,
      announcement: str('discord_announcement_webhook_url') || null,
      leadership: str('discord_leadership_webhook_url') || null,
      unlinked: str('discord_unlinked_webhook_url') || null,
    };
  } catch (err) {
    console.error('Discord routing lookup failed (falling back to normal routing):', err);
  }

  routeCache = { config, at: now };
  return config;
}

/** The test-routing destination while the override is on, else null. Consulted by the transport. */
export async function overrideWebhookUrl(): Promise<string | null> {
  return (await routeConfig()).override;
}

/** Drop the cached routing so the next send re-reads the settings rows. Called after a config write. */
export function invalidateDiscordRouteCache(): void {
  routeCache = null;
}

/**
 * Resolve which webhook a message goes to: the announcement or leadership channel when that is what
 * this is and one is set, else the clan's own channel, else the global DISCORD_WEBHOOK_URL. Returns
 * null when nothing is configured anywhere (feature disabled).
 *
 * The chain FALLS THROUGH rather than branching, so an unconfigured announcement channel is not a
 * dead end — it means "announcements have no home of their own yet", and they keep landing exactly
 * where they did before the purpose axis existed.
 *
 * This resolves the NORMAL destination and deliberately ignores the routing override — the redirect
 * is applied at send time so it covers every path, not only the ones that call this.
 */
export async function webhookUrlForClan(
  clanId?: string | null,
  purpose: ChannelPurpose = 'default',
): Promise<string | null> {
  if (purpose !== 'default') {
    const config = await routeConfig();
    const dedicated =
      purpose === 'announcement'
        ? config.announcement
        : purpose === 'unlinked'
          ? config.unlinked || config.leadership
          : config.leadership;
    if (dedicated) return dedicated;
  }
  if (clanId) {
    const { data } = await supabase
      .from('clans')
      .select('discord_webhook_url')
      .eq('id', clanId)
      .maybeSingle();
    if (data?.discord_webhook_url) return data.discord_webhook_url;
  }
  return process.env.DISCORD_WEBHOOK_URL || null;
}
