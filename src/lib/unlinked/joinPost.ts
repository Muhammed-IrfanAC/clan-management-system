import type { DiscordActionRow, DiscordMessage } from '@/lib/discord/types';
import { LEADERSHIP_ROLE_ID } from '@/lib/discord/roles';
import { discordTs } from '@/lib/discord/format';
import { stampResolution, withoutOption } from '@/lib/discord/interactions/resolution';
import type { Reply } from '@/lib/discord/interactions/types';
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
 *
 * An alert also outlives its joiners: many leave again before anybody links them. Each later sync
 * re-checks the joiners of every open alert (`joinOutcome`) and stamps the ones that need nothing
 * more — left, moved to another family clan, linked elsewhere — onto the alert the same way a click
 * does (`settleAlert`), so a leader never goes looking for a player who is no longer there.
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

/** A joiner of an alert that is still open, as `unlinked_join_alerts` records it. */
export type OpenAlertEntry = { message_id: string; channel_id: string; player_tag: string; clan_id: string };

export type JoinerNow = {
  player_tag: string;
  person_id: string | null;
  status: string | null;
  clan_id: string | null;
  in_game_name: string | null;
};

export type JoinOutcome =
  | { kind: 'left' }
  | { kind: 'moved'; toClanId: string }
  | { kind: 'linked'; personId: string }
  | { kind: 'gone' };

/**
 * Whether a joiner still needs the alert, judged from their account now: null while they are still
 * an unlinked member of the clan they joined. Linked wins over everything else — a player linked and
 * then gone needs no line about leaving, the link already settled them. 'left' is also what an
 * account in another clan that this pass did not poll looks like (sync marks a departure 'left'
 * without clearing `clan_id`), and it is true of the clan the alert is about either way.
 */
export function joinOutcome(entry: Pick<OpenAlertEntry, 'clan_id'>, account: JoinerNow | undefined): JoinOutcome | null {
  if (!account) return { kind: 'gone' };
  if (account.person_id) return { kind: 'linked', personId: account.person_id };
  if (account.status !== 'active') return { kind: 'left' };
  if (account.clan_id && account.clan_id !== entry.clan_id) return { kind: 'moved', toClanId: account.clan_id };
  return null;
}

export type SettledJoiner = { tag: string; outcome: JoinOutcome };

export function outcomeLine(
  tag: string,
  outcome: JoinOutcome,
  names: { clan: (id: string) => string; person: (id: string) => string },
  nowIso: string,
): string {
  const who = `\`${tag}\``;
  switch (outcome.kind) {
    case 'left':
      return `🚪 ${who} left ${discordTs(nowIso, 'R')}, before anyone linked them`;
    case 'moved':
      return `↪️ ${who} moved to **${escapeMarkdown(names.clan(outcome.toClanId))}** ${discordTs(nowIso, 'R')}, before anyone linked them`;
    case 'linked':
      return `🔗 ${who} was linked to **${escapeMarkdown(names.person(outcome.personId))}** outside this alert`;
    case 'gone':
      return `🗑️ ${who} was removed from ClanOps`;
  }
}

/**
 * The alert with its settled joiners stamped and dropped from the "Link…" select, or null when there
 * is nothing to change. A joiner linked from the alert itself is already stamped and gone from the
 * select (the click did both), so a link is only stamped while the select still offers the account —
 * that is what tells a link made from the dashboard or `/link` apart from one made here. Departures
 * are always stamped: the select stops at 25 accounts, and a joiner past that leaving is still news.
 */
export function settleAlert(
  alert: DiscordMessage,
  settled: SettledJoiner[],
  line: (s: SettledJoiner) => string,
): Reply | null {
  let components = alert.components;
  const lines: string[] = [];
  for (const s of settled) {
    const offered = (components ?? []).some((row) =>
      row.components.some((c) => c.type === 3 && c.custom_id === linkIds.pick() && c.options.some((o) => o.value === s.tag)),
    );
    if (s.outcome.kind === 'linked' && !offered) continue;
    lines.push(line(s));
    components = withoutOption(components, linkIds.pick(), s.tag);
  }
  if (!lines.length) return null;
  const remaining = components ?? [];
  return stampResolution(alert, lines.join('\n'), { components: remaining, stillOpen: remaining.length > 0 });
}
