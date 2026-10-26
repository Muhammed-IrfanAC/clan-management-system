import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Destination } from './types';

const h = vi.hoisted(() => ({ override: null as Destination | null }));
vi.mock('./routing', () => ({
  overrideDestination: async () => h.override,
  fallbackDestination: () => null,
}));

import { postOrEditDiscordMessage, sendDirectMessage, sendDiscordMessage } from './transport';

const CH = '111111111111111111';
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
      { channelId: CH },
    );
    expect(ok).toBe(true);
    expect(calls[0].url).toBe(`https://discord.com/api/v10/channels/${CH}/messages`);
    expect(calls[0].headers.Authorization).toBe('Bot bot-token');
    expect(calls[0].body).toEqual({ content: `<@${USER}>`, embeds: [], allowed_mentions: { users: [USER] } });
  });

  it('sends buttons with the message', async () => {
    const components = [{ type: 1 as const, components: [{ type: 2 as const, style: 1 as const, label: 'Go', custom_id: 'x:v1' }] }];
    await sendDiscordMessage({ content: 'hi', components }, { channelId: CH });
    expect(calls[0].body!.components).toEqual(components);
  });

  it('redirects to the override and labels a bot message as test routing', async () => {
    h.override = { channelId: CH };
    await sendDiscordMessage({ content: 'hi' }, { channelId: '222222222222222222' });
    expect(calls[0].url).toBe(`https://discord.com/api/v10/channels/${CH}/messages`);
    expect(calls[0].body!.content).toBe('-# 🧪 ClanOps · test routing\nhi');
  });

  it('is a no-op with nowhere to send, and fails safe on a Discord error', async () => {
    expect(await sendDiscordMessage({ content: 'hi' }, null)).toBe(false);
    expect(calls).toHaveLength(0);
    responses.push(new Response('nope', { status: 403 }));
    expect(await sendDiscordMessage({ content: 'hi' }, { channelId: CH })).toBe(false);
  });

  it('refuses a bot send without a token rather than calling Discord', async () => {
    vi.stubEnv('DISCORD_BOT_TOKEN', '');
    expect(await sendDiscordMessage({ content: 'hi' }, { channelId: CH })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('retries once on a short rate limit', async () => {
    vi.useFakeTimers();
    responses.push(new Response(JSON.stringify({ retry_after: 0.2 }), { status: 429 }));
    const sent = sendDiscordMessage({ content: 'hi' }, { channelId: CH });
    await vi.advanceTimersByTimeAsync(250);
    expect(await sent).toBe(true);
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it('does not stall a sync on a long rate limit', async () => {
    responses.push(new Response(JSON.stringify({ retry_after: 30 }), { status: 429 }));
    expect(await sendDiscordMessage({ content: 'hi' }, { channelId: CH })).toBe(false);
    expect(calls).toHaveLength(1);
  });
});

describe('postOrEditDiscordMessage', () => {
  it('edits the stored message through the bot', async () => {
    const id = await postOrEditDiscordMessage({ content: 'v2' }, { destination: { channelId: CH }, messageId: 'm9' });
    expect(id).toBe('m9');
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toBe(`https://discord.com/api/v10/channels/${CH}/messages/m9`);
  });

  it('posts fresh when the stored message belongs to another sender (e.g. a retired webhook)', async () => {
    responses.push(new Response('{"code":50005}', { status: 403 }));
    responses.push(new Response(JSON.stringify({ id: 'm10' }), { status: 200 }));
    const id = await postOrEditDiscordMessage({ content: 'v2' }, { destination: { channelId: CH }, messageId: 'old-webhook-msg' });
    expect(id).toBe('m10');
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'POST']);
    expect(calls[1].body).not.toHaveProperty('username');
  });
});

describe('sendDirectMessage', () => {
  it('opens a DM channel and posts into it, ignoring the routing override', async () => {
    h.override = { channelId: CH };
    responses.push(new Response(JSON.stringify({ id: 'dm-channel' }), { status: 200 }));
    expect(await sendDirectMessage(`<@${USER}>`, { content: 'code 123456' })).toBe(true);
    expect(calls.map((c) => c.url)).toEqual([
      'https://discord.com/api/v10/users/@me/channels',
      'https://discord.com/api/v10/channels/dm-channel/messages',
    ]);
    expect(calls[0].body).toEqual({ recipient_id: USER });
    expect(calls[1].body).toEqual({ content: 'code 123456' });
  });

  it('fails when the DM channel cannot be opened, or for a malformed user id', async () => {
    responses.push(new Response('{"message":"Cannot send messages to this user"}', { status: 403 }));
    expect(await sendDirectMessage(USER, { content: 'x' })).toBe(false);
    expect(calls).toHaveLength(1);
    expect(await sendDirectMessage('not-an-id', { content: 'x' })).toBe(false);
    expect(calls).toHaveLength(1);
  });
});
