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
import { expiryOf, type StrikeLevel } from './strikes/status';
import type { DetectedViolation } from './rules/types';

// Discord embed colors (decimal). Amber for warnings; strikes take the member's live strike LEVEL
// colour (green/orange/red) so the embed mirrors the dashboard badge — see LEVEL_COLOR below.
const COLOR_WARNING = 0xf59e0b;

// Strike-level → embed colour, matching the dashboard tokens (--color-cta / --color-warning /
// --color-danger). green=1 active, orange=2, red>=3; clear is a defensive fallback only.
const LEVEL_COLOR: Record<StrikeLevel, number> = {
  clear: 0x94a3b8,
  green: 0x22c55e,
  orange: 0xf59e0b,
  red: 0xef4444,
};
const LEVEL_EMOJI: Record<StrikeLevel, string> = {
  clear: '⚪',
  green: '🟢',
  orange: '🟠',
  red: '🔴',
};

/** A Discord timestamp token that each reader's client renders in their own local timezone.
 * `D` = long date (e.g. "12 October 2026"), `R` = relative (e.g. "in 2 months"). See
 * https://discord.com/developers/docs/reference#message-formatting-timestamp-styles. */
function discordTs(iso: string, style: 'd' | 'D' | 'f' | 'F' | 'R' = 'D'): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:${style}>`;
}

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
 *
 * The embed is scoped to the fielded ACCOUNT's live strike standing (`loadStrikeNotifyContext`):
 * the title names the strike NUMBER (Strike 1/2/3…), the embed colour follows the green/orange/red
 * LEVEL, and an "Active record" field spells out the new strike number. The prior active strikes
 * are listed separately, so the current offence is never duplicated in the history field.
 */
export async function notifyStrikeLogged(params: {
  memberName?: string | null;
  playerTag: string;
  ruleName?: string | null;
  warLabel?: string | null;
  reasons: string[];        // one line per folded violation
  // Present only for Better Late Than Never. It drives the evidence-first late-snipe layout.
  lateSnipe?: { windowHours: number; violations: DetectedViolation[] };
  strikeNumber: number;     // this account's active strike count after this strike (1, 2, 3…)
  level: StrikeLevel;       // drives the embed colour + title emoji
  // full active list on the account, oldest-first; leadershipApproved marks trust-restored strikes
  activeStrikes: { issuedAt: string; label: string; leadershipApproved: boolean }[];
  webhookUrl?: string | null;
  mentionDiscordId?: string | null;
}): Promise<void> {
  const {
    memberName, playerTag, ruleName, warLabel, reasons, lateSnipe,
    strikeNumber, level, activeStrikes, webhookUrl, mentionDiscordId,
  } = params;

  const fields: DiscordEmbedField[] = lateSnipe
    ? lateSnipeFields({ memberName, playerTag, warLabel, strikeNumber, activeStrikes, lateSnipe })
    : standardStrikeFields({ memberName, playerTag, ruleName, warLabel, reasons, strikeNumber, activeStrikes });

  // This notification is sent only when a new strike is created. The newest list item is therefore
  // the current strike above; show only older active strikes here. Lines are oldest-first and capped
  // so we never blow Discord's 1024-char field limit. Each line shows when the strike EXPIRES (issue + 90d,
  // the moment it stops counting) rather than when it was logged — that's the date the member cares
  // about. The expiry is emitted as a Discord timestamp token so every reader sees it in their own
  // local timezone (long date + a relative "in N days" hint). Trust-restored strikes lead with a bold
  // "Restored" tag so their status reads first and stays visually distinct from live, unresolved ones.
  const previousActiveStrikes = activeStrikes.slice(0, -1);
  if (previousActiveStrikes.length) {
    const lines = previousActiveStrikes.map((s, i) => {
      const expiry = expiryOf(s.issuedAt);
      const expires = `${discordTs(expiry, 'D')} (${discordTs(expiry, 'R')})`;
      const tag = s.leadershipApproved ? '**[Restored]** ' : '';
      return `\`${i + 1}.\` ${tag}${s.label} — expires ${expires}`;
    });
    fields.push({
      name: `Previous active strike${previousActiveStrikes.length === 1 ? '' : 's'}`,
      value: truncateField(lines.join('\n')),
      inline: false,
    });
  }

  const removalNote = level === 'red' ? ' — removal threshold reached' : '';
  const title = lateSnipe
    ? `${LEVEL_EMOJI[level]} Strike ${strikeNumber} of 3 Issued — Better Late Than Never${removalNote}`
    : `${LEVEL_EMOJI[level]} Strike ${strikeNumber} Issued${removalNote}`;

  await sendDiscordMessage(
    {
      content: mentionDiscordId ? `<@${mentionDiscordId}>` : undefined,
      allowed_mentions: mentionDiscordId ? { users: [mentionDiscordId] } : { parse: [] },
      embeds: [
        {
          title,
          color: LEVEL_COLOR[level],
          fields,
          footer: { text: 'ClanOps · trust restoration required before Elder/war eligibility returns' },
        },
      ],
    },
    webhookUrl,
  );
}

function standardStrikeFields(params: Pick<Parameters<typeof notifyStrikeLogged>[0],
  'memberName' | 'playerTag' | 'ruleName' | 'warLabel' | 'reasons' | 'strikeNumber' | 'activeStrikes'>): DiscordEmbedField[] {
  const { memberName, playerTag, ruleName, warLabel, reasons, strikeNumber, activeStrikes } = params;
  const fields: DiscordEmbedField[] = [
    { name: 'Member', value: `${memberName || 'Unknown'} (${playerTag})`, inline: true },
  ];
  if (warLabel) fields.push({ name: 'War', value: warLabel, inline: true });
  const currentStrike = [
    ruleName ? `**${ruleName}**` : null,
    reasons.length ? reasons.map((r) => `• ${r}`).join('\n') : 'A war rule was broken.',
  ].filter(Boolean).join('\n');
  fields.push({ name: 'Current strike', value: currentStrike, inline: false });
  fields.push({
    name: 'Active record',
    value: `This is **Strike ${strikeNumber}** of **${activeStrikes.length} active strike${activeStrikes.length === 1 ? '' : 's'}**.`,
    inline: false,
  });
  fields.push({
    name: 'Consequence',
    value: 'War-ineligible until you contact leadership, acknowledge the rule break, and confirm you understand the timing rule.',
    inline: false,
  });
  return fields;
}

function lateSnipeFields(params: {
  memberName?: string | null;
  playerTag: string;
  warLabel?: string | null;
  strikeNumber: number;
  activeStrikes: { issuedAt: string; label: string; leadershipApproved: boolean }[];
  lateSnipe: { windowHours: number; violations: DetectedViolation[] };
}): DiscordEmbedField[] {
  const { memberName, playerTag, warLabel, strikeNumber, activeStrikes, lateSnipe } = params;
  const windowHours = Number.isFinite(lateSnipe.windowHours) && lateSnipe.windowHours > 0
    ? lateSnipe.windowHours
    : 6;
  const remaining = lateSnipe.violations
    .flatMap((v) => {
      const hits = v.evidence?.late_attacks;
      return Array.isArray(hits)
        ? hits.map((hit) => Number((hit as { hours_left?: unknown }).hours_left)).filter(Number.isFinite)
        : [Number(v.evidence?.hours_left)].filter(Number.isFinite);
    })
    .map(formatRemainingTime);
  const attackEvidence = remaining.length
    ? remaining.map((time, index) => `• **Attack ${index + 1}:** ${time} remaining in war`).join('\n')
    : '• **Attack detected** during the late-snipe window.';

  const fields: DiscordEmbedField[] = [
    { name: 'Evidence of violation', value: `${attackEvidence}\n• **Rule deadline:** before the final **${formatHours(windowHours)}** of war\n• **Result:** **Attack was late.**` },
    { name: 'Member', value: `${memberName || 'Unknown'} (${playerTag})`, inline: true },
    ...(warLabel ? [{ name: 'War', value: warLabel, inline: true }] : []),
    { name: 'Strike record', value: `This is **Strike ${strikeNumber} of 3** active strikes.` },
  ];
  const currentStrike = activeStrikes.at(-1);
  if (currentStrike) {
    const expiry = expiryOf(currentStrike.issuedAt);
    fields.push({ name: 'Strike expires', value: `${discordTs(expiry, 'D')} (${discordTs(expiry, 'R')})` });
  }
  fields.push(
    { name: 'Why early attacks matter', value: 'Early attacks show awareness, keep pressure on the enemy, and reduce pressure on leadership. Even in a perfect war, Elders should still loot or hit any base to show they are active and aligned.' },
    { name: 'Consequence', value: 'War-ineligible until the player contacts leadership, owns the rule break, and confirms they understand the timing rule.' },
  );
  return fields;
}

function formatRemainingTime(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const wholeHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${wholeHours}h ${String(minutes).padStart(2, '0')}m`;
}

function formatHours(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours} hours`;
}

/** Keep an embed field within Discord's 1024-char limit, trimming whole lines from the tail. */
function truncateField(value: string): string {
  if (value.length <= 1024) return value;
  const lines = value.split('\n');
  let out = '';
  for (const line of lines) {
    if (out.length + line.length + 1 > 980) break;
    out += (out ? '\n' : '') + line;
  }
  return `${out}\n…`;
}
