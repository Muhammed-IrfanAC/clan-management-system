import type { DiscordActionRow, DiscordMessage } from '@/lib/discord/types';
import { LEADERSHIP_ROLE_ID } from '@/lib/discord/roles';
import { linkIds } from './linkPanel';

/**
 * PURE half of the "an unlinked player joined" alert. `joinAlert.ts` is the DB/send half.
 *
 * Sync creates an account for every new member with no person behind it, and until a leader links
 * it the account is invisible to everything person-scoped — Discord pings, the dossier, alt-aware
 * kick watching. So each join of an unlinked account is posted for leadership to act on, with the
 * Leadership role pinged.
 *
 * The ping sits in plain `content`, not the embed: a mention inside an embed renders but never
 * notifies, and the notification is the point.
 *
 * Through the bot the alert carries a "Link…" select of its joiners: picking one opens a private
 * link panel (`linkPanel.ts`), and each link is stamped onto the alert and drops out of the select,
 * so what is left is what is still open.
 */

/** Discord allows at most 25 options in a select. */
const MAX_OPTIONS = 25;

const COLOR_ALERT = 0xf59e0b;
// Discord caps an embed description at 4096 characters; a line is well under 100, so this leaves room.
const MAX_LINES = 30;

export type UnlinkedAccount = {
  player_tag: string;
  person_id: string | null;
  in_game_name: string | null;
  th_level: number | null;
};

export type UnlinkedJoiner = { name: string; tag: string; thLevel: number | null };

/**
 * The arrivals worth alerting on, grouped by the clan they joined (in arrival order): accounts with
 * no person behind them. An account on the kick list is left out — the kick-list alert already
 * tells leadership about it, with the reason, and a second ping for the same join is noise.
 */
export function selectUnlinkedJoins(
  arrivals: { tag: string; clanId: string }[],
  accounts: Map<string, UnlinkedAccount>,
  kickedTags: Set<string>,
): Map<string, UnlinkedJoiner[]> {
  const byClan = new Map<string, UnlinkedJoiner[]>();
  const seen = new Set<string>();
  for (const a of arrivals) {
    const account = accounts.get(a.tag);
    if (!account || account.person_id || kickedTags.has(a.tag) || seen.has(a.tag)) continue;
    seen.add(a.tag);
    const list = byClan.get(a.clanId) ?? [];
    list.push({ name: account.in_game_name || a.tag, tag: a.tag, thLevel: account.th_level });
    byClan.set(a.clanId, list);
  }
  return byClan;
}

/** Player names are free text, and a stray `*` or `_` would turn the rest of the line bold. */
function escapeMarkdown(s: string): string {
  return s.replace(/([*_`~|\\>])/g, '\\$1');
}

export function renderUnlinkedJoins(clanName: string, joiners: UnlinkedJoiner[]): DiscordMessage {
  const n = joiners.length;
  const lines = joiners
    .slice(0, MAX_LINES)
    .map((j) => `• **${escapeMarkdown(j.name)}** \`${j.tag}\`${j.thLevel ? ` · TH${j.thLevel}` : ''}`);
  if (n > MAX_LINES) lines.push(`…and ${n - MAX_LINES} more`);

  return {
    content:
      `<@&${LEADERSHIP_ROLE_ID}> ${n === 1 ? 'An unlinked player' : `${n} unlinked players`} joined ` +
      `**${escapeMarkdown(clanName)}** — please take the necessary action.`,
    // Only the Leadership role may ping — never a stray user or @everyone from a player's name.
    allowed_mentions: { parse: [], roles: [LEADERSHIP_ROLE_ID] },
    embeds: [
      {
        title: `🔗 ${n === 1 ? 'Unlinked player' : 'Unlinked players'} joined ${clanName}`,
        description: lines.join('\n'),
        color: COLOR_ALERT,
        footer: { text: 'ClanOps · link them to a person under Members → Unlinked Accounts' },
      },
    ],
    components: linkSelect(joiners),
  };
}

function linkSelect(joiners: UnlinkedJoiner[]): DiscordActionRow[] {
  return [{
    type: 1,
    components: [{
      type: 3,
      custom_id: linkIds.pick(),
      placeholder: 'Link an account to a person…',
      options: joiners.slice(0, MAX_OPTIONS).map((j) => ({
        label: j.name.slice(0, 100),
        value: j.tag,
        description: `${j.tag}${j.thLevel ? ` · TH${j.thLevel}` : ''}`,
      })),
    }],
  }];
}
