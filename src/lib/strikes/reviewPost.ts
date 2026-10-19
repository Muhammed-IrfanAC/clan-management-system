import { ButtonStyle, type DiscordMessage } from '@/lib/discord/types';
import { discordTs, truncateField } from '@/lib/discord/format';
import { encodeCustomId } from '@/lib/discord/interactions/customId';

/**
 * PURE renderer for a queued strike suggestion (hit-up review). `reviewAlert.ts` is the send half.
 *
 * A judgement detector does not strike — it asks. Until now the question only surfaced on the
 * dashboard, so it sat until someone happened to open the review queue. This posts it to the
 * leadership channel with Confirm / Dismiss buttons that act exactly as the dashboard does
 * (`strikes/review.ts`), and the message is stamped with who acted and how.
 *
 * The footer still points at the dashboard queue, which is where the same review can be settled.
 */

export const REVIEW_NS = 'review';
const VERSION = 1;
const COLOR_REVIEW = 0xf59e0b;

export type ReviewPost = {
  suggestionId: string;
  memberName: string | null;
  playerTag: string | null;
  clanName: string | null;
  ruleName: string;
  warLabel: string | null;
  description: string;
  occurredAt: string | null;
};

function escapeMarkdown(s: string): string {
  return s.replace(/([*_`~|\\>])/g, '\\$1');
}

export function reviewButtonId(suggestionId: string, action: 'confirm' | 'dismiss'): string {
  return encodeCustomId(REVIEW_NS, VERSION, [suggestionId, action]);
}

export function renderReviewSuggestion(p: ReviewPost): DiscordMessage {
  const who = `**${escapeMarkdown(p.memberName || p.playerTag || 'Unknown player')}**${p.playerTag ? ` \`${p.playerTag}\`` : ''}`;
  const where = [p.clanName && escapeMarkdown(p.clanName), p.warLabel && escapeMarkdown(p.warLabel)].filter(Boolean).join(' · ');

  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `⚖️ Review: ${p.ruleName}`,
        description: `${who}${where ? `\n${where}` : ''}`,
        color: COLOR_REVIEW,
        fields: [
          { name: 'What was detected', value: truncateField(p.description || '_No detail recorded._'), inline: false },
          ...(p.occurredAt ? [{ name: 'When', value: discordTs(p.occurredAt, 'f'), inline: false }] : []),
        ],
        footer: { text: 'ClanOps · confirming folds it into this war’s strike · also under Strikes → Needs Review' },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: ButtonStyle.DANGER, label: 'Confirm strike', custom_id: reviewButtonId(p.suggestionId, 'confirm') },
          { type: 2, style: ButtonStyle.SECONDARY, label: 'Dismiss', custom_id: reviewButtonId(p.suggestionId, 'dismiss') },
        ],
      },
    ],
  };
}
