import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClanOpsDb, FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));

import { destinationForClan, invalidateDiscordRouteCache, overrideDestination, pickDestination } from './routing';

const CH = '111111111111111111';
const CH2 = '222222222222222222';
const HOOK = 'https://discord.com/api/webhooks/1/clan';

function setting(key: string, value: unknown) {
  h.db.seed('settings', [{ key, value }]);
}

beforeEach(() => {
  h.db = createClanOpsDb();
  invalidateDiscordRouteCache();
  vi.stubEnv('DISCORD_BOT_TOKEN', 'token');
  vi.stubEnv('DISCORD_WEBHOOK_URL', '');
  vi.stubEnv('DISCORD_DEFAULT_CHANNEL_ID', '');
  h.db.seed('clans', [{ id: 'main', display_name: 'Main', discord_webhook_url: HOOK, discord_channel_id: null }]);
});

afterEach(() => vi.unstubAllEnvs());

describe('pickDestination', () => {
  it('prefers the channel only while the bot can use it', () => {
    expect(pickDestination({ channelId: CH, webhookUrl: HOOK }, true)).toEqual({ kind: 'channel', channelId: CH });
    expect(pickDestination({ channelId: CH, webhookUrl: HOOK }, false)).toEqual({ kind: 'webhook', url: HOOK });
    expect(pickDestination({ channelId: CH, webhookUrl: null }, false)).toBeNull();
  });

  it('ignores a channel id that is not a snowflake', () => {
    expect(pickDestination({ channelId: 'general', webhookUrl: HOOK }, true)).toEqual({ kind: 'webhook', url: HOOK });
  });
});

describe('destinationForClan', () => {
  it('uses the clan webhook until the clan has a bot channel', async () => {
    expect(await destinationForClan('main')).toEqual({ kind: 'webhook', url: HOOK });
    h.db.find('clans', 'main')!.discord_channel_id = CH;
    expect(await destinationForClan('main')).toEqual({ kind: 'channel', channelId: CH });
  });

  it('falls back to webhooks for every step when the token is removed', async () => {
    h.db.find('clans', 'main')!.discord_channel_id = CH;
    vi.stubEnv('DISCORD_BOT_TOKEN', '');
    expect(await destinationForClan('main')).toEqual({ kind: 'webhook', url: HOOK });
  });

  it('routes a purpose to its bot channel, falling through to the clan when unset', async () => {
    expect(await destinationForClan('main', 'leadership')).toEqual({ kind: 'webhook', url: HOOK });
    setting('discord_leadership_channel_id', CH2);
    invalidateDiscordRouteCache();
    expect(await destinationForClan('main', 'leadership')).toEqual({ kind: 'channel', channelId: CH2 });
    // Unlinked inherits leadership before the clan channel.
    expect(await destinationForClan('main', 'unlinked')).toEqual({ kind: 'channel', channelId: CH2 });
  });

  it('ends at the family-wide fallback, the bot channel first', async () => {
    expect(await destinationForClan(null)).toBeNull();
    vi.stubEnv('DISCORD_WEBHOOK_URL', 'https://discord.com/api/webhooks/9/global');
    expect(await destinationForClan(null)).toEqual({ kind: 'webhook', url: 'https://discord.com/api/webhooks/9/global' });
    vi.stubEnv('DISCORD_DEFAULT_CHANNEL_ID', CH);
    expect(await destinationForClan(null)).toEqual({ kind: 'channel', channelId: CH });
  });
});

describe('overrideDestination', () => {
  it('applies only while switched on, preferring the bot channel', async () => {
    setting('discord_override_webhook_url', 'https://discord.com/api/webhooks/2/test');
    setting('discord_override_channel_id', CH2);
    setting('discord_override_enabled', false);
    expect(await overrideDestination()).toBeNull();

    h.db.find('settings', 'discord_override_enabled')!.value = true;
    invalidateDiscordRouteCache();
    expect(await overrideDestination()).toEqual({ kind: 'channel', channelId: CH2 });
  });
});
