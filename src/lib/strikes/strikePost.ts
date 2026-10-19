/**
 * Pure renderer for the "strike issued" Discord notice. The send half is the caller's: pass the
 * result to `sendDiscordMessage` with the member's clan channel.
 */

import { COLOR_WARNING, discordTs, truncateField } from '@/lib/discord/format';
import type { DiscordEmbedField, DiscordMessage } from '@/lib/discord/types';
import type { DetectedViolation } from '@/lib/rules/types';
import { expiryOf, type StrikeLevel } from './status';

// Strike-level → embed colour, matching the dashboard tokens (--color-cta / --color-warning /
// --color-danger). green=1 active, orange=2, red>=3; clear is a defensive fallback only.
const LEVEL_COLOR: Record<StrikeLevel, number> = {
  clear: 0x94a3b8,
  green: 0x22c55e,
  orange: COLOR_WARNING,
  red: 0xef4444,
};
const LEVEL_EMOJI: Record<StrikeLevel, string> = {
  clear: '⚪',
  green: '🟢',
  orange: '🟠',
  red: '🔴',
};

export interface StrikePostParams {
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
  /** The member's Discord id (`discordUserIdForPerson`); null sends the same notice without a ping. */
  mentionDiscordId?: string | null;
}

/**
 * A STRIKE was issued against a member (one strike per war; it may carry several reasons).
 *
 * The embed is scoped to the fielded ACCOUNT's live strike standing (`loadStrikeNotifyContext`):
 * the title names the strike NUMBER (Strike 1/2/3…), the embed colour follows the green/orange/red
 * LEVEL, and an "Active record" field spells out the new strike number. The prior active strikes
 * are listed separately, so the current offence is never duplicated in the history field.
 */
export function renderStrikePost(params: StrikePostParams): DiscordMessage {
  const {
    memberName, playerTag, ruleName, warLabel, reasons, lateSnipe,
    strikeNumber, level, activeStrikes, mentionDiscordId,
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

  return {
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
  };
}

function standardStrikeFields(params: Pick<StrikePostParams,
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
