/**
 * The Discord transport: the ONLY module that talks to discord.com.
 *
 * Delivers to a channel through the bot's REST API (DISCORD_BOT_TOKEN). Callers resolve the
 * destination with `destinationForClan`.
 *
 * FAIL-SAFE throughout. Every send is best-effort: a missing destination, a network hiccup, or a
 * non-2xx response is logged and swallowed so a notification failure can NEVER break the request that
 * triggered it (logging a warning, syncing, etc). If nothing is configured the whole thing is a no-op,
 * so the feature is entirely opt-in per environment.
 *
 * ROUTING OVERRIDE (migration 027): while `discord_override_enabled` is on, every message is
 * redirected to the override destination regardless of which channel the caller resolved — the
 * testing-phase mode where the whole family's traffic lands in one private channel. The redirect is
 * applied HERE, the single choke point every notification passes through, so it cannot be bypassed
 * by a caller that forgets about it (including one written later). A bot cannot rename itself per
 * message, so a message in the test channel carries a `ClanOps · test routing` subtext line instead.
 *
 * Two send primitives: `sendDiscordMessage` for one-shot announcements (a strike, a lineup notice),
 * and `postOrEditDiscordMessage` for a LIVING message that is edited in place as the underlying data
 * changes — the CWL roster post. Both resolve their destination the same way, override included.
 */

import { normalizeDiscordId } from './format';
import { fallbackDestination, overrideDestination } from './routing';
import type { Destination, DiscordMessage } from './types';

const API = 'https://discord.com/api/v10';
const TEST_LABEL = 'ClanOps · test routing';

/** A 429 asking us to wait longer than this is not retried — a sync should not stall on Discord. */
const MAX_RETRY_WAIT_MS = 5_000;

/**
 * Last line of defence before an `allowed_mentions` block reaches Discord: a malformed id, a
 * duplicate, or more than the 100 Discord permits makes it reject the ENTIRE message with a 400 —
 * one bad row would cost a whole roster announcement. Callers build this list from resolved ids, so
 * this normally changes nothing; it exists so a bad id degrades to "named, not pinged".
 */
function sanitizeMentions(m: NonNullable<DiscordMessage['allowed_mentions']>): NonNullable<DiscordMessage['allowed_mentions']> {
  const clean = (ids: string[]) =>
    [...new Set(ids.map(normalizeDiscordId).filter((id): id is string => !!id))].slice(0, 100);
  return {
    ...m,
    ...(m.users ? { users: clean(m.users) } : {}),
    ...(m.roles ? { roles: clean(m.roles) } : {}),
  };
}

/** The destination after the override, else the caller's, else the global fallback. */
async function resolve(dest: Destination | null | undefined): Promise<{ to: Destination | null; test: boolean }> {
  const override = await overrideDestination();
  return { to: override || dest || fallbackDestination(), test: !!override };
}

/** A bot message cannot carry a per-message username, so the test label rides in the content. */
function labelled(content: string, test: boolean): string {
  return test ? `-# 🧪 ${TEST_LABEL}${content ? `\n${content}` : ''}` : content;
}

/**
 * Send a one-shot message to `dest` (from `destinationForClan`); if omitted, falls back to the
 * family-wide channel. Returns true if Discord accepted it, false on any failure (including nothing
 * configured). Never throws.
 */
export async function sendDiscordMessage(
  payload: DiscordMessage,
  dest?: Destination | null,
): Promise<boolean> {
  // The override wins over whatever the caller resolved: during the testing phase EVERY notification
  // belongs in the one private channel. Mentions are left live — the point of a rehearsal channel is
  // to see exactly what the real message would look like, pings included.
  const { to, test } = await resolve(dest);
  if (!to) return false; // Feature disabled in this environment — no-op.

  const allowed_mentions = payload.allowed_mentions ? sanitizeMentions(payload.allowed_mentions) : { parse: [] };

  const content = labelled(payload.content ?? '', test);
  const sent = await request(`${API}/channels/${to.channelId}/messages`, 'POST', {
    ...(content ? { content } : {}),
    embeds: payload.embeds ?? [],
    ...(payload.components?.length ? { components: payload.components } : {}),
    allowed_mentions,
  }, { bot: true });
  return sent !== null;
}

/**
 * Post a message and keep a handle on it, or EDIT the one we posted before — the primitive behind a
 * "living" message that stays correct instead of being superseded by a newer, contradicting post.
 *
 * Returns the message id to store (unchanged on a successful edit, new on a fresh post), or null if
 * nothing could be sent. Never throws, like every send here.
 *
 * An edit that fails falls back to posting fresh. That is the self-healing path for a destination
 * that moved underneath us: a message can only be edited through the channel and the sender that
 * created it, so a re-pointed clan channel, a flip of the routing override (migration 027), or a
 * message a retired webhook posted (before 038) makes the stored id unresolvable and Discord answers
 * 404 or 403. Posting fresh is the correct response — the old message belongs to a sender or a
 * channel we are no longer writing with.
 */
export async function postOrEditDiscordMessage(
  payload: DiscordMessage,
  opts: { destination?: Destination | null; messageId?: string | null } = {},
): Promise<string | null> {
  const { to, test } = await resolve(opts.destination);
  if (!to) return null; // Feature disabled in this environment — no-op.

  // `content` is sent even when empty so an edit can CLEAR a previous message's text (Discord treats
  // an omitted field as "leave unchanged"); a roster that no longer has pending moves must not keep
  // the old ping line.
  const body = {
    content: labelled(payload.content ?? '', test),
    embeds: payload.embeds ?? [],
    allowed_mentions: sanitizeMentions(payload.allowed_mentions ?? { parse: [] }),
    ...(payload.components ? { components: payload.components } : {}),
  };

  if (opts.messageId) {
    const edited = await request(
      `${API}/channels/${to.channelId}/messages/${encodeURIComponent(opts.messageId)}`, 'PATCH', body, { bot: true },
    );
    if (edited) return opts.messageId;
    // fall through and post fresh
  }

  const created = await request(`${API}/channels/${to.channelId}/messages`, 'POST', body, { bot: true });
  return (created as { id?: string } | null)?.id || null;
}

/**
 * A raw call to the bot's REST API, for the bot features that are not channel messages (reading a
 * channel to verify access, DMs, roles, interaction follow-ups). Same fail-safe contract: null means
 * "did not happen", and the reason is logged. `path` is relative to the versioned API root.
 */
export async function discordBotRequest(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<unknown | null> {
  return request(`${API}${path.startsWith('/') ? path : `/${path}`}`, method, body, { bot: true });
}

/**
 * Fill in the reply to a DEFERRED interaction (the "thinking…" placeholder). Authenticated by the
 * interaction token rather than the bot token, valid for 15 minutes after the interaction arrived.
 * Not subject to the routing override: a reply belongs to the person who asked, wherever they asked.
 */
export async function editInteractionReply(
  applicationId: string,
  interactionToken: string,
  payload: DiscordMessage,
): Promise<boolean> {
  const sent = await request(
    `${API}/webhooks/${applicationId}/${encodeURIComponent(interactionToken)}/messages/@original`,
    'PATCH',
    {
      content: payload.content ?? '',
      embeds: payload.embeds ?? [],
      components: payload.components ?? [],
      allowed_mentions: sanitizeMentions(payload.allowed_mentions ?? { parse: [] }),
    },
  );
  return sent !== null;
}

/**
 * A further message on an interaction, after its first response — e.g. telling the clicker why a
 * deferred button press did nothing. Same interaction-token auth and override exemption as above.
 */
export async function sendInteractionFollowUp(
  applicationId: string,
  interactionToken: string,
  payload: DiscordMessage & { ephemeral?: boolean },
): Promise<boolean> {
  const { ephemeral, ...rest } = payload;
  const sent = await request(`${API}/webhooks/${applicationId}/${encodeURIComponent(interactionToken)}`, 'POST', {
    ...rest,
    allowed_mentions: sanitizeMentions(rest.allowed_mentions ?? { parse: [] }),
    ...(ephemeral ? { flags: 1 << 6 } : {}),
  });
  return sent !== null;
}

/**
 * One fetch, JSON in and out, every failure logged and swallowed. Null means "did not happen".
 *
 * A 429 is retried ONCE when Discord asks for a short wait: a sync can fire a burst of notices into
 * one channel (a strike pass, a round reveal across clans), and losing one of them to a rate limit
 * Discord told us exactly how to avoid would be a silent miss. A long wait is not worth stalling for.
 */
async function request(
  url: string,
  method: string,
  body: unknown,
  opts: { bot?: boolean; retried?: boolean } = {},
): Promise<unknown | null> {
  // The only unauthenticated-by-bot calls left are interaction replies (interaction-token auth).
  const label = opts.bot ? 'Discord bot' : 'Discord interaction';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bot) {
    const token = process.env.DISCORD_BOT_TOKEN?.trim();
    if (!token) {
      console.error(`${label} ${method} skipped: DISCORD_BOT_TOKEN is not set`);
      return null;
    }
    headers.Authorization = `Bot ${token}`;
    headers['User-Agent'] = 'DiscordBot (https://github.com/clanops, 1.0)';
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (res.status === 429 && !opts.retried) {
      const info = (await res.json().catch(() => ({}))) as { retry_after?: number };
      const waitMs = Math.ceil((Number(info.retry_after) || Number(res.headers.get('retry-after')) || 1) * 1000);
      if (waitMs <= MAX_RETRY_WAIT_MS) {
        await new Promise((r) => setTimeout(r, waitMs));
        return request(url, method, body, { ...opts, retried: true });
      }
      console.error(`${label} ${method} rate limited for ${waitMs}ms (not retried)`);
      return null;
    }
    if (!res.ok) {
      console.error(`${label} ${method} returned ${res.status}: ${await res.text().catch(() => '')}`);
      return null;
    }
    if (res.status === 204) return {};
    return await res.json().catch(() => ({}));
  } catch (err) {
    console.error(`${label} ${method} failed (non-fatal):`, err);
    return null;
  }
}
