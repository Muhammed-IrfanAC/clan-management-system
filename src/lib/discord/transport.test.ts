import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Destination } from './types';

const h = vi.hoisted(() => ({ override: null as Destination | null }));
vi.mock('./routing', () => ({
  overrideDestination: async () => h.override,
  fallbackDestination: () => null,
}));

import { postOrEditDiscordMessage, sendDiscordMessage } from './transport';

const CH = '111111111111111111';
const HOOK = 'https://discord.com/api/webhooks/1/tok';
const USER = '123456789012345678';

type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | undefined };
let calls: Call[];
let responses: Response[];

beforeEach(() => {
  h.override = null;
  calls = [];
  responses = [];
  vi.stubEnv('DISCORD_BOT_TOKEN', 'bot-token');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method!,
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    return responses.shift() ?? new Response(JSON.stringify({ id: 'm1' }), { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('sendDiscordMessage', () => {
  it('posts to a channel through the bot, without a username', async () => {
    const ok = await sendDiscordMessage(
      { content: `<@${USER}>`, allowed_mentions: { users: [USER, 'junk'] } },
      { kind: 'channel', channelId: CH },
    );
    expect(ok).toBe(true);
    expect(calls[0].url).toBe(`https://discord.com/api/v10/channels/${CH}/messages`);
    expect(calls[0].headers.Authorization).toBe('Bot bot-token');
    expect(calls[0].body).toEqual({ content: `<@${USER}>`, embeds: [], allowed_mentions: { users: [USER] } });
  });

  it('posts to a webhook as before, with no bot credentials', async () => {
    await sendDiscordMessage({ content: 'hi' }, { kind: 'webhook', url: HOOK });
    expect(calls[0].url).toBe(HOOK);
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect(calls[0].body).toEqual({ username: 'ClanOps', content: 'hi', allowed_mentions: { parse: [] } });
  });

  it('sends buttons through the bot, and drops them for a webhook, which cannot carry them', async () => {
    const components = [{ type: 1 as const, components: [{ type: 2 as const, style: 1 as const, label: 'Go', custom_id: 'x:v1' }] }];
    await sendDiscordMessage({ content: 'hi', components }, { kind: 'channel', channelId: CH });
    await sendDiscordMessage({ content: 'hi', components }, { kind: 'webhook', url: HOOK });
    expect(calls[0].body!.components).toEqual(components);
    expect(calls[1].body).toEqual({ username: 'ClanOps', content: 'hi', allowed_mentions: { parse: [] } });
  });

  it('redirects to the override and labels a bot message as test routing', async () => {
    h.override = { kind: 'channel', channelId: CH };
    await sendDiscordMessage({ content: 'hi' }, { kind: 'webhook', url: HOOK });
    expect(calls[0].url).toBe(`https://discord.com/api/v10/channels/${CH}/messages`);
    expect(calls[0].body!.content).toBe('-# 🧪 ClanOps · test routing\nhi');
  });

  it('renames a webhook message under the override', async () => {
    h.override = { kind: 'webhook', url: HOOK };
    await sendDiscordMessage({ content: 'hi', username: 'Someone' }, null);
    expect(calls[0].body!.username).toBe('ClanOps · test routing');
  });

  it('is a no-op with nowhere to send, and fails safe on a Discord error', async () => {
    expect(await sendDiscordMessage({ content: 'hi' }, null)).toBe(false);
    expect(calls).toHaveLength(0);
    responses.push(new Response('nope', { status: 403 }));
    expect(await sendDiscordMessage({ content: 'hi' }, { kind: 'channel', channelId: CH })).toBe(false);
  });

  it('refuses a bot send without a token rather than calling Discord', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', '');
    expect(await sendDiscordMessage({ content: 'hi' }, { kind: 'channel', channelId: CH })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('retries once on a short rate limit', async () => {
    vi.useFakeTimers();
    responses.push(new Response(JSON.stringify({ retry_after: 0.2 }), { status: 429 }));
    const sent = sendDiscordMessage({ content: 'hi' }, { kind: 'channel', channelId: CH });
    await vi.advanceTimersByTimeAsync(250);
    expect(await sent).toBe(true);
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it('does not stall a sync on a long rate limit', async () => {
    responses.push(new Response(JSON.stringify({ retry_after: 30 }), { status: 429 }));
    expect(await sendDiscordMessage({ content: 'hi' }, { kind: 'channel', channelId: CH })).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('postOrEditDiscordMessage', () => {
  it('edits the stored message through the bot', async () => {
    const id = await postOrEditDiscordMessage({ content: 'v2' }, { destination: { kind: 'channel', channelId: CH }, messageId: 'm9' });
    expect(id).toBe('m9');
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toBe(`https://discord.com/api/v10/channels/${CH}/messages/m9`);
  });

  it('posts fresh when the stored message belongs to another sender (webhook → bot cutover)', async () => {
    responses.push(new Response('{"code":50005}', { status: 403 }));
    responses.push(new Response(JSON.stringify({ id: 'm10' }), { status: 200 }));
    const id = await postOrEditDiscordMessage({ content: 'v2' }, { destination: { kind: 'channel', channelId: CH }, messageId: 'old-webhook-msg' });
    expect(id).toBe('m10');
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'POST']);
    expect(calls[1].body).not.toHaveProperty('username');
  });

  it('keeps the webhook flow: wait=true on post, username stripped on edit', async () => {
    await postOrEditDiscordMessage({ content: 'v1' }, { destination: { kind: 'webhook', url: HOOK } });
    expect(calls[0].url).toBe(`${HOOK}?wait=true`);
    expect(calls[0].body!.username).toBe('ClanOps');

    await postOrEditDiscordMessage({ content: 'v2' }, { destination: { kind: 'webhook', url: HOOK }, messageId: 'm1' });
    expect(calls[1].url).toBe(`${HOOK}/messages/m1`);
    expect(calls[1].body).not.toHaveProperty('username');
  });
});
