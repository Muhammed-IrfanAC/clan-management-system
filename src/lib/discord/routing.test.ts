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
const CH3 = '333333333333333333';

function setting(key: string, value: unknown) {
  h.db.seed('settings', [{ key, value }]);
}

beforeEach(() => {
  h.db = createClanOpsDb();
  invalidateDiscordRouteCache();
  vi.stubEnv('DISCORD_BOT_TOKEN', 'token');
  vi.stubEnv('DISCORD_DEFAULT_CHANNEL_ID', '');
  h.db.seed('clans', [{ id: 'main', display_name: 'Main', discord_channel_id: CH }]);
});

afterEach(() => vi.unstubAllEnvs());

describe('pickDestination', () => {
  it('resolves a channel only while the bot can use it', () => {
    expect(pickDestination(CH, true)).toEqual({ channelId: CH });
    expect(pickDestination(CH, false)).toBeNull();
    expect(pickDestination(null, true)).toBeNull();
  });

  it('ignores a channel id that is not a snowflake', () => {
    expect(pickDestination('general', true)).toBeNull();
  });
});

describe('destinationForClan', () => {
  it('posts to the clan channel', async () => {
    expect(await destinationForClan('main')).toEqual({ channelId: CH });
  });

  it('sends nothing when the token is removed', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', '');
    expect(await destinationForClan('main')).toBeNull();
  });

  it('routes a purpose to its channel, falling through to the clan when unset', async () => {
    expect(await destinationForClan('main', 'leadership')).toEqual({ channelId: CH });
    setting('discord_leadership_channel_id', CH2);
    invalidateDiscordRouteCache();
    expect(await destinationForClan('main', 'leadership')).toEqual({ channelId: CH2 });
    // Unlinked inherits leadership before the clan channel.
    expect(await destinationForClan('main', 'unlinked')).toEqual({ channelId: CH2 });
  });

  it('sends a clan’s unlinked-join alerts to its own join channel or thread first', async () => {
    setting('discord_unlinked_channel_id', CH2);
    h.db.find('clans', 'main')!.discord_join_channel_id = CH3;
    expect(await destinationForClan('main', 'unlinked')).toEqual({ channelId: CH3 });
    // Only that purpose: the clan's other notices and leadership alerts are unaffected.
    expect(await destinationForClan('main')).toEqual({ channelId: CH });
    expect(await destinationForClan('main', 'leadership')).toEqual({ channelId: CH });
    // Unset, the shared unlinked-join channel takes it as before.
    h.db.find('clans', 'main')!.discord_join_channel_id = null;
    expect(await destinationForClan('main', 'unlinked')).toEqual({ channelId: CH2 });
  });

  it('ends at the family-wide fallback channel', async () => {
    h.db.find('clans', 'main')!.discord_channel_id = null;
    expect(await destinationForClan('main')).toBeNull();
    vi.stubEnv('DISCORD_DEFAULT_CHANNEL_ID', CH3);
    expect(await destinationForClan('main')).toEqual({ channelId: CH3 });
    expect(await destinationForClan(null)).toEqual({ channelId: CH3 });
  });
});

describe('overrideDestination', () => {
  it('applies only while switched on', async () => {
    setting('discord_override_channel_id', CH2);
    setting('discord_override_enabled', false);
    expect(await overrideDestination()).toBeNull();

    h.db.find('settings', 'discord_override_enabled')!.value = true;
    invalidateDiscordRouteCache();
    expect(await overrideDestination()).toEqual({ channelId: CH2 });
  });
});
