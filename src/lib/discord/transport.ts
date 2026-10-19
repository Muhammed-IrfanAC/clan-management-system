/**
 * The Discord transport: the ONLY module that talks to discord.com.
 *
 * A thin, FAIL-SAFE wrapper around Discord's incoming-webhook API. Every send is best-effort:
 * a missing webhook URL, a network hiccup, or a non-2xx response is logged and swallowed so a
 * notification failure can NEVER break the request that triggered it (logging a warning, syncing,
 * etc). Mirrors the optional-integration pattern used for `COC_API_PROXY_URL` — if no webhook is
 * configured the whole thing is a no-op, so the feature is entirely opt-in per environment.
 *
 * ROUTING OVERRIDE (migration 027): while `discord_override_enabled` is on, every message is
 * redirected to `discord_override_webhook_url` regardless of which channel the caller resolved — the
 * testing-phase mode where the whole family's traffic lands in one private channel. The redirect is
 * applied HERE, the single choke point every notification passes through, so it cannot be bypassed
 * by a caller that forgets about it (including one written later).
 *
 * Two send primitives: `sendDiscordMessage` for one-shot announcements (a strike, a lineup notice),
 * and `postOrEditDiscordMessage` for a LIVING message that is edited in place as the underlying data
 * changes — the CWL roster post. Both resolve their destination the same way, override included.
 */

import { normalizeDiscordId } from './format';
import { overrideWebhookUrl } from './routing';
import type { DiscordMessage } from './types';

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

/**
 * POST a message to a Discord webhook. Pass the target `webhookUrl` (from `webhookUrlForClan`); if
 * omitted, falls back to the global DISCORD_WEBHOOK_URL. Returns true if Discord accepted it, false
 * on any failure (including no webhook configured). Never throws.
 */
export async function sendDiscordMessage(
  payload: DiscordMessage & { username?: string },
  webhookUrl?: string | null,
): Promise<boolean> {
  // The override wins over whatever the caller resolved: during the testing phase EVERY notification
  // belongs in the one private channel. Mentions are left live — the point of a rehearsal channel is
  // to see exactly what the real message would look like, pings included.
  const override = await overrideWebhookUrl();
  const url = override || webhookUrl || process.env.DISCORD_WEBHOOK_URL;
  if (!url) return false; // Feature disabled in this environment — no-op.

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'ClanOps',
        allowed_mentions: { parse: [] },
        ...payload,
        ...(payload.allowed_mentions ? { allowed_mentions: sanitizeMentions(payload.allowed_mentions) } : {}),
        // Applied AFTER the payload so it cannot be overridden: a message in the test channel must
        // never be mistaken for one the family actually received.
        ...(override ? { username: 'ClanOps · test routing' } : {}),
      }),
    });
    if (!res.ok) {
      console.error(`Discord webhook returned ${res.status}: ${await res.text().catch(() => '')}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Discord webhook send failed (non-fatal):', err);
    return false;
  }
}

/**
 * Post a message and keep a handle on it, or EDIT the one we posted before — the primitive behind a
 * "living" message that stays correct instead of being superseded by a newer, contradicting post.
 *
 * Returns the message id to store (unchanged on a successful edit, new on a fresh post), or null if
 * nothing could be sent. Never throws, like every send here.
 *
 * Two Discord details this hides from callers:
 *   - a fresh post only returns the created message (and therefore its id) when `?wait=true` is set;
 *   - the edit endpoint accepts ONLY content/embeds/allowed_mentions, so `username` is dropped —
 *     which is also why an edited message keeps the name it was originally posted under.
 *
 * An edit that fails falls back to posting fresh. That is the self-healing path for a destination
 * that moved underneath us: editing requires the same webhook that created the message, so a
 * re-pointed clan channel or a flip of the routing override (migration 027) makes the stored id
 * unresolvable and Discord answers 404. Posting fresh is the correct response — the old message is
 * in a channel we are no longer writing to.
 */
export async function postOrEditDiscordMessage(
  payload: DiscordMessage,
  opts: { webhookUrl?: string | null; messageId?: string | null; username?: string } = {},
): Promise<string | null> {
  const override = await overrideWebhookUrl();
  const base = override || opts.webhookUrl || process.env.DISCORD_WEBHOOK_URL;
  if (!base) return null; // Feature disabled in this environment — no-op.

  // `content` is sent even when empty so an edit can CLEAR a previous message's text (Discord treats
  // an omitted field as "leave unchanged"); a roster that no longer has pending moves must not keep
  // the old ping line.
  const body = {
    content: payload.content ?? '',
    embeds: payload.embeds ?? [],
    allowed_mentions: sanitizeMentions(payload.allowed_mentions ?? { parse: [] }),
  };

  if (opts.messageId) {
    const edited = await request(editUrl(base, opts.messageId), 'PATCH', body);
    if (edited) return opts.messageId;
    // fall through and post fresh
  }

  const created = await request(postUrl(base), 'POST', {
    username: override ? 'ClanOps · test routing' : opts.username || 'ClanOps',
    ...body,
  });
  return (created as { id?: string } | null)?.id || null;
}

/** Webhook URL with `wait=true`, so Discord returns the created message (and its id). */
function postUrl(base: string): string {
  const u = new URL(base);
  u.searchParams.set('wait', 'true');
  return u.toString();
}

/** The edit endpoint for one message previously posted through this webhook. */
function editUrl(base: string, messageId: string): string {
  const u = new URL(base);
  return `${u.origin}${u.pathname.replace(/\/$/, '')}/messages/${encodeURIComponent(messageId)}`;
}

/** One fetch, JSON in and out, every failure logged and swallowed. Null means "did not happen". */
async function request(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`Discord webhook ${method} returned ${res.status}: ${await res.text().catch(() => '')}`);
      return null;
    }
    return await res.json().catch(() => ({}));
  } catch (err) {
    console.error(`Discord webhook ${method} failed (non-fatal):`, err);
    return null;
  }
}
