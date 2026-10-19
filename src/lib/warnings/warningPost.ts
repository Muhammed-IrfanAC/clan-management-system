/**
 * Pure renderer for the legacy "warning logged" Discord notice (the warnings system is sunset, but
 * its route still posts). The send half is the caller's.
 */

import { COLOR_WARNING } from '@/lib/discord/format';
import type { DiscordEmbedField, DiscordMessage } from '@/lib/discord/types';

/**
 * `mentionDiscordId` (the member's `persons.discord_user_id`, resolved via `discordUserIdForPerson`)
 * @-mentions the warned member when set: it both pings the user and prepends their mention to the
 * message. Pass null (member has no linked Discord) to send the same notification without a ping.
 */
export function renderWarningPost(params: {
  memberName?: string | null;
  playerTag: string;
  ruleName?: string | null;
  description: string;
  loggedBy: string; // human display name of the actor, not their tag
  mentionDiscordId?: string | null;
}): DiscordMessage {
  const { memberName, playerTag, ruleName, description, loggedBy, mentionDiscordId } = params;

  const fields: DiscordEmbedField[] = [
    { name: 'Member', value: `${memberName || 'Unknown'} (${playerTag})`, inline: true },
    { name: 'Logged by', value: loggedBy, inline: true },
  ];
  if (ruleName) fields.push({ name: 'Rule', value: ruleName, inline: false });

  return {
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
  };
}
