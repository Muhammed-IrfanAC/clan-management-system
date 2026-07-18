/**
 * Discord webhook notifications.
 *
 * A thin, FAIL-SAFE wrapper around Discord's incoming-webhook API. Every send is best-effort:
 * a missing webhook URL, a network hiccup, or a non-2xx response is logged and swallowed so a
 * notification failure can NEVER break the request that triggered it (logging a warning, syncing,
 * etc). Mirrors the optional-integration pattern used for `COC_API_PROXY_URL` — if no webhook is
 * configured the whole thing is a no-op, so the feature is entirely opt-in per environment.
 *
 * Routing: each clan may have its own webhook (`clans.discord_webhook_url`) so events post to a
 * clan-specific channel; when a clan has none, we fall back to the global DISCORD_WEBHOOK_URL env
 * var. Resolve the URL with `webhookUrlForClan()` and pass it to the send helpers.
 */

import { supabase } from './supabase';

// Discord embed colors (decimal). Amber for warnings, red for strikes.
const COLOR_WARNING = 0xf59e0b;
const COLOR_STRIKE = 0xdc2626;

type DiscordEmbedField = { name: string; value: string; inline?: boolean };

type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  timestamp?: string;
  footer?: { text: string };
};

/**
 * Resolve which webhook a clan's notifications go to: the clan's own channel if configured,
 * otherwise the global DISCORD_WEBHOOK_URL. Returns null when neither is set (feature disabled).
 */
export async function webhookUrlForClan(clanId?: string | null): Promise<string | null> {
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

/**
 * Resolve a person's Discord user id for @-mentioning them in a notification. Returns null when the
 * person has no linked Discord (persons.discord_user_id is NULL) or the id is unknown — callers pass
 * the result straight to `mentionDiscordId`, where null simply means "no ping". Fail-safe: any DB
 * error resolves to null so a notification can still be sent without a mention.
 */
export async function discordUserIdForPerson(personId?: string | null): Promise<string | null> {
  if (!personId) return null;
  const { data } = await supabase
    .from('persons')
    .select('discord_user_id')
    .eq('id', personId)
    .maybeSingle();
  return data?.discord_user_id?.trim() || null;
}

/**
 * POST a message to a Discord webhook. Pass the target `webhookUrl` (from `webhookUrlForClan`); if
 * omitted, falls back to the global DISCORD_WEBHOOK_URL. Returns true if Discord accepted it, false
 * on any failure (including no webhook configured). Never throws.
 */
export async function sendDiscordMessage(
  payload: {
    content?: string;
    embeds?: DiscordEmbed[];
    username?: string;
    // Restrict which mentions actually ping. Defaults to none so stray text can't mass-ping.
    allowed_mentions?: { parse?: Array<'users' | 'roles' | 'everyone'>; users?: string[] };
  },
  webhookUrl?: string | null,
): Promise<boolean> {
  const url = webhookUrl || process.env.DISCORD_WEBHOOK_URL;
  if (!url) return false; // Feature disabled in this environment — no-op.

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'ClanOps',
        allowed_mentions: { parse: [] },
        ...payload,
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
 * Notify a Discord channel that a warning was logged against a member. Best-effort — see module
 * docs. Pass `webhookUrl` from `webhookUrlForClan(clanId)` to target the member's clan channel.
 *
 * `mentionDiscordId` (the member's `persons.discord_user_id`, resolved via `discordUserIdForPerson`)
 * @-mentions the warned member when set: it both pings the user and prepends their mention to the
 * message. Pass null (member has no linked Discord) to send the same notification without a ping.
 */
export async function notifyWarningLogged(params: {
  memberName?: string | null;
  playerTag: string;
  ruleName?: string | null;
  description: string;
  loggedBy: string; // human display name of the actor, not their tag
  webhookUrl?: string | null;
  mentionDiscordId?: string | null;
}): Promise<void> {
  const { memberName, playerTag, ruleName, description, loggedBy, webhookUrl, mentionDiscordId } =
    params;

  const fields: DiscordEmbedField[] = [
    { name: 'Member', value: `${memberName || 'Unknown'} (${playerTag})`, inline: true },
    { name: 'Logged by', value: loggedBy, inline: true },
  ];
  if (ruleName) fields.push({ name: 'Rule', value: ruleName, inline: false });

  await sendDiscordMessage(
    {
      content: mentionDiscordId ? `<@${mentionDiscordId}>` : undefined,
      allowed_mentions: mentionDiscordId ? { users: [mentionDiscordId] } : { parse: [] },
      embeds: [
        {
          title: '⚠️ Warning Logged',
          description,
          color: COLOR_WARNING,
          fields,
          footer: { text: 'ClanOps' },
        },
      ],
    },
    webhookUrl,
  );
}

/**
 * Notify a Discord channel that a STRIKE was issued against a member (one strike per war; it may
 * carry several reasons). Best-effort — see module docs. `mentionDiscordId` @-mentions the member.
 * The richer end-of-war roll-up (all new + outstanding strikes) lands in a later phase; this is the
 * immediate per-strike ping so the member is told the moment a war-break is detected.
 */
export async function notifyStrikeLogged(params: {
  memberName?: string | null;
  playerTag: string;
  ruleName?: string | null;
  warLabel?: string | null;
  reasons: string[];        // one line per folded violation
  webhookUrl?: string | null;
  mentionDiscordId?: string | null;
}): Promise<void> {
  const { memberName, playerTag, ruleName, warLabel, reasons, webhookUrl, mentionDiscordId } = params;

  const fields: DiscordEmbedField[] = [
    { name: 'Member', value: `${memberName || 'Unknown'} (${playerTag})`, inline: true },
  ];
  if (warLabel) fields.push({ name: 'War', value: warLabel, inline: true });
  if (ruleName) fields.push({ name: 'Rule', value: ruleName, inline: false });

  const description = reasons.length
    ? reasons.map((r) => `• ${r}`).join('\n')
    : 'A war rule was broken.';

  await sendDiscordMessage(
    {
      content: mentionDiscordId ? `<@${mentionDiscordId}>` : undefined,
      allowed_mentions: mentionDiscordId ? { users: [mentionDiscordId] } : { parse: [] },
      embeds: [
        {
          title: '🛑 Strike Issued',
          description,
          color: COLOR_STRIKE,
          fields,
          footer: { text: 'ClanOps · trust restoration required before Elder/war eligibility returns' },
        },
      ],
    },
    webhookUrl,
  );
}
