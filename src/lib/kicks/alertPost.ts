import type { DiscordEmbedField, DiscordMessage } from '@/lib/discord/types';
import { LEADERSHIP_ROLE_ID } from '@/lib/discord/roles';

/**
 * PURE renderer for the "a kicked player is back" alert. `arrivals.ts` is the DB/send half.
 *
 * It goes to the leadership channel (falling back to the clan channel while none is set) and pings
 * the Leadership role so someone acts on it — never the player: the point is that leadership
 * notices, not that the player is called out. The ping sits in plain `content`, because a mention
 * inside an embed renders but never notifies.
 */

const COLOR_ALERT = 0xef4444;
const FIELD_LIMIT = 1024;

export type KickedArrivalPost = {
  /** The account that joined. */
  name: string;
  tag: string;
  thLevel: number | null;
  clanName: string;
  /** True when the joiner is another account of the kicked player's person, not the kicked one. */
  viaAlt: boolean;
  personName: string | null;
  /** The account on the kick list. Same as name/tag unless viaAlt. */
  kickedName: string;
  kickedTag: string;
  kickedFromClanName: string | null;
  kickedAt: string;
  kickedByName: string;
  comment: string | null;
};

/** Player names are free text, and a stray `*` or `_` would turn the rest of the line bold. */
function escapeMarkdown(s: string): string {
  return s.replace(/([*_`~|\\>])/g, '\\$1');
}

function discordDate(iso: string): string {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? iso : `<t:${Math.floor(ms / 1000)}:D>`;
}

function truncate(s: string): string {
  return s.length <= FIELD_LIMIT ? s : `${s.slice(0, FIELD_LIMIT - 1)}…`;
}

export function renderKickedArrival(p: KickedArrivalPost): DiscordMessage {
  const who = `**${escapeMarkdown(p.name)}** \`${p.tag}\`${p.thLevel ? ` (TH${p.thLevel})` : ''}`;
  const clan = `**${escapeMarkdown(p.clanName)}**`;

  const description = p.viaAlt
    ? `${who} joined ${clan}. It is an alt of **${escapeMarkdown(p.personName || 'a kicked player')}**, whose account ` +
      `**${escapeMarkdown(p.kickedName)}** \`${p.kickedTag}\` is on the kick list.`
    : `${who} is back in ${clan} — this account is on the kick list.`;

  const from = p.kickedFromClanName ? ` from ${escapeMarkdown(p.kickedFromClanName)}` : '';
  const fields: DiscordEmbedField[] = [
    { name: 'Kicked', value: `${discordDate(p.kickedAt)}${from} by ${escapeMarkdown(p.kickedByName)}`, inline: false },
    { name: 'Reason', value: truncate(p.comment?.trim() || '_No comment recorded._'), inline: false },
  ];

  return {
    content: `<@&${LEADERSHIP_ROLE_ID}> ${p.viaAlt ? 'An alt of a kicked player' : 'A kicked player'} joined ${clan} — please take the necessary action.`,
    // Only the Leadership role may ping — never the player or a stray mention from a name.
    allowed_mentions: { parse: [], roles: [LEADERSHIP_ROLE_ID] },
    embeds: [
      {
        title: p.viaAlt ? `⛔ Alt of a kicked player joined ${p.clanName}` : `⛔ Kicked player joined ${p.clanName}`,
        description,
        color: COLOR_ALERT,
        fields,
        footer: { text: 'ClanOps · kick list — remove the entry there if they are welcome back' },
      },
    ],
  };
}
