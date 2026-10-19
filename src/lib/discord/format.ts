/**
 * Pure Discord formatting helpers shared by every renderer. No I/O, so renderers stay testable.
 */

/** Discord embed colour for warnings and "something changed" notices (amber, decimal). */
export const COLOR_WARNING = 0xf59e0b;

/** A Discord timestamp token that each reader's client renders in their own local timezone.
 * `D` = long date (e.g. "12 October 2026"), `R` = relative (e.g. "in 2 months"). See
 * https://discord.com/developers/docs/reference#message-formatting-timestamp-styles. */
export function discordTs(iso: string, style: 'd' | 'D' | 'f' | 'F' | 'R' = 'D'): string {
  const ms = new Date(iso).getTime();
  // A value Date cannot parse would render literally as `<t:NaN:f>`. Callers normalise CoC's compact
  // timestamps with parseCoCTime (see lib/cocTime.ts); this is the backstop so a miss anywhere else
  // degrades to the raw string instead of printing NaN at the family.
  if (Number.isNaN(ms)) return iso;
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

/** Keep an embed field within Discord's 1024-char limit, trimming whole lines from the tail. */
export function truncateField(value: string): string {
  if (value.length <= 1024) return value;
  const lines = value.split('\n');
  let out = '';
  for (const line of lines) {
    if (out.length + line.length + 1 > 980) break;
    out += (out ? '\n' : '') + line;
  }
  return `${out}\n…`;
}

/**
 * `persons.discord_user_id` is free text a leader types, so it can hold a username ("irfan"), a
 * pasted mention ("<@123>"), or nothing usable. Discord only accepts snowflakes in
 * `allowed_mentions.users` and rejects the WHOLE message with a 400 on anything else — so a single
 * mistyped field would silently kill an entire roster transfer call. Normalize to a bare snowflake
 * here, at the one place ids enter the notification path, and treat anything else as "not linked".
 */
export function normalizeDiscordId(raw?: string | null): string | null {
  const id = (raw || '').trim().replace(/^<@!?/, '').replace(/>$/, '');
  return isSnowflake(id) ? id : null;
}

/**
 * A channel id as a leader is likely to paste it: the bare id (Developer Mode → Copy Channel ID), a
 * channel mention (`<#123>`), or a channel link (`https://discord.com/channels/<guild>/<channel>`,
 * from Copy Link). Anything else is "not set" rather than a value Discord would reject later.
 */
export function normalizeChannelId(raw?: string | null): string | null {
  const s = (raw || '').trim();
  const link = s.match(/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/\d+\/(\d+)\/?$/);
  const id = link ? link[1] : s.replace(/^<#/, '').replace(/>$/, '');
  return isSnowflake(id) ? id : null;
}

function isSnowflake(id: string): boolean {
  return /^\d{15,25}$/.test(id);
}
