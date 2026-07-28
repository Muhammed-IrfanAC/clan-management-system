import type { DiscordEmbedField, DiscordMessage } from '@/lib/discord';
import { tierLabel } from './leagues';

/**
 * PURE renderers for the three CWL roster announcements. No I/O, no Supabase, no fetch — feed them
 * view models, get back a Discord message payload. `rosterPostNotify.ts` is the DB/send half, exactly
 * the split `lineup.ts` / `lineupNotify.ts` uses.
 *
 * Being pure is not just tidiness here: it is what lets the dashboard PREVIEW the exact message that
 * will be posted, because the preview endpoint and the sender call the same function.
 *
 * Three templates, because a roster has three different audiences:
 *
 *   A. renderClanRoster      → the clan's own channel. Who is playing, who is benched. Posted once
 *                              and then EDITED as transfers land, so the channel holds one message
 *                              that is always current rather than a stack of stale ones. No pings:
 *                              30 people do not need a notification to read a list.
 *   B. renderTransferCall    → family-wide, at `transfers_pending`. ONLY the accounts that must move
 *                              in-game, and the one message here that legitimately @-mentions
 *                              people, because it is asking them to do something.
 *   C. renderLeadershipDigest→ leadership channel. Fill per clan at a glance. Earns its place by
 *                              surfacing the priority waterfall's failure mode — a low-priority clan
 *                              left short of a full lineup — where leaders will actually see it,
 *                              instead of only on the roster board.
 */

const COLOR_OK = 0x22c55e;
const COLOR_WARN = 0xf59e0b;
const COLOR_INFO = 0x3b82f6;

/** Discord's per-field value limit. Long lists are split across fields rather than truncated. */
const FIELD_LIMIT = 1024;

/** One allocated account, as the board knows it. */
export interface RosterEntry {
  playerTag: string;
  name: string;
  thLevel: number;
  leagueTier: number | null;
  isBench: boolean;
  /** The engine's strength ordering. Null sorts last — an unranked row is not a strong row. */
  rank: number | null;
}

export interface ClanRosterInput {
  seasonLabel: string;
  clanName: string;
  warSize: number;
  entries: RosterEntry[];
}

/** Template A — one clan's roster, for that clan's channel. */
export function renderClanRoster(input: ClanRosterInput): DiscordMessage {
  const { seasonLabel, clanName, warSize, entries } = input;
  const sorted = entries.slice().sort(byRank);
  const lineup = sorted.filter((e) => !e.isBench);
  const bench = sorted.filter((e) => e.isBench);

  const short = Math.max(0, warSize - lineup.length);

  const fields: DiscordEmbedField[] = [
    ...fieldsFrom(`Lineup (${lineup.length})`, lineup.map(entryLine)),
    ...fieldsFrom(`Bench (${bench.length})`, bench.map(entryLine)),
  ];
  if (fields.length === 0) {
    fields.push({ name: 'Roster', value: 'No accounts allocated to this clan.' });
  }
  if (bench.length) {
    fields.push({
      name: 'Note',
      value: 'Bench: stay in the clan for the whole week — you can be called up for any round.',
    });
  }

  return {
    allowed_mentions: { parse: [] }, // informational; nobody gets pinged by a roster list
    embeds: [
      {
        title: `🏆 ${clanName} — CWL ${seasonLabel}`,
        description: short
          ? `**${lineup.length}/${warSize}** in the lineup — **${short} short** · ${bench.length} on the bench`
          : `**${lineup.length}/${warSize}** in the lineup · ${bench.length} on the bench`,
        color: short ? COLOR_WARN : COLOR_OK,
        fields,
        footer: { text: 'ClanOps · CWL — this message is kept up to date as the roster changes' },
      },
    ],
  };
}

/** One required in-game move, ready to render. `mentionId` null = name them, don't ping them. */
export interface TransferMove {
  name: string;
  playerTag: string;
  mentionId: string | null;
  fromClanName: string | null;
  toClanName: string;
}

/** Template B — the moves that must happen before sign-up. The one message that pings. */
export function renderTransferCall(input: { seasonLabel: string; moves: TransferMove[] }): DiscordMessage {
  const { seasonLabel, moves } = input;

  if (moves.length === 0) {
    return {
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `✅ CWL ${seasonLabel} — no moves needed`,
          description: 'Everyone is already in the clan they are rostered for. Sit tight.',
          color: COLOR_OK,
          footer: { text: 'ClanOps · CWL' },
        },
      ],
    };
  }

  // Ping only the people being asked to act, and restrict allowed_mentions to exactly those ids so
  // no name elsewhere in the message can resolve into a ping.
  const mentionIds = moves.map((m) => m.mentionId).filter((id): id is string => !!id);
  const lines = moves.map((m) => {
    const who = m.mentionId ? `<@${m.mentionId}>` : `**${m.name}**`;
    const from = m.fromClanName ? `${m.fromClanName} → ` : '';
    return `• ${who} (${m.name}) — ${from}**${m.toClanName}**`;
  });

  return {
    content: mentionIds.length ? mentionIds.map((id) => `<@${id}>`).join(' ') : undefined,
    allowed_mentions: { users: mentionIds },
    embeds: [
      {
        title: `📦 CWL ${seasonLabel} — moves needed before sign-up`,
        description: `**${moves.length}** account${moves.length === 1 ? '' : 's'} need to change clan. Everyone else: stay where you are.`,
        color: COLOR_WARN,
        fields: fieldsFrom('Move to', lines),
        footer: { text: 'ClanOps · CWL — leadership marks each move done as it lands' },
      },
    ],
  };
}

export interface DigestClan {
  clanName: string;
  warSize: number;
  lineupCount: number;
  benchCount: number;
}

/** Template C — family-wide fill summary for the leadership channel. */
export function renderLeadershipDigest(input: {
  seasonLabel: string;
  clans: DigestClan[]; // already in fill-priority order
  unassigned: number;
  pendingMoves: number;
}): DiscordMessage {
  const { seasonLabel, clans, unassigned, pendingMoves } = input;

  // Monospace: this table is read by scanning a column, which only works if the columns line up.
  const width = Math.max(0, ...clans.map((c) => c.clanName.length));
  const rows = clans.map((c) => {
    const short = Math.max(0, c.warSize - c.lineupCount);
    const fill = `${c.lineupCount}/${c.warSize}`.padEnd(7);
    const bench = c.benchCount ? `+ ${c.benchCount} bench` : '';
    return `${short ? '!' : ' '} ${c.clanName.padEnd(width)}  ${fill}${bench}${short ? `  SHORT ${short}` : ''}`;
  });

  const shortClans = clans.filter((c) => c.lineupCount < c.warSize).length;

  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `📋 CWL ${seasonLabel} — roster formed`,
        description: rows.length ? `\`\`\`\n${rows.join('\n')}\n\`\`\`` : 'No clans in this season.',
        color: shortClans ? COLOR_WARN : COLOR_INFO,
        fields: [
          {
            name: 'Status',
            value: [
              shortClans
                ? `⚠️ **${shortClans}** clan${shortClans === 1 ? '' : 's'} short of a full lineup — the pool ran out before the last clan filled.`
                : '✅ Every clan has a full lineup.',
              `${unassigned} eligible account${unassigned === 1 ? '' : 's'} unassigned.`,
              `${pendingMoves} move${pendingMoves === 1 ? '' : 's'} still pending.`,
            ].join('\n'),
          },
        ],
        footer: { text: 'ClanOps · CWL' },
      },
    ],
  };
}

/** Engine rank ascending, unranked last, name as the stable tiebreak. */
function byRank(a: RosterEntry, b: RosterEntry): number {
  const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
  const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
  if (ra !== rb) return ra - rb;
  return a.name.localeCompare(b.name);
}

function entryLine(entry: RosterEntry, index: number): string {
  return `\`${String(index + 1).padStart(2, '0')}.\` ${entry.name} — TH${entry.thLevel || '?'} · ${tierLabel(entry.leagueTier)}`;
}

/**
 * Pack lines into as many fields as they need. A 30-player lineup is roughly 1200 characters, which
 * silently overflows Discord's 1024-char field limit — and the failure mode of overflowing is the
 * whole message being rejected, i.e. no roster at all. Splitting keeps every name.
 */
function fieldsFrom(name: string, lines: string[], limit = FIELD_LIMIT): DiscordEmbedField[] {
  if (lines.length === 0) return [];
  const chunks: string[] = [];
  let current = '';
  for (const raw of lines) {
    const line = raw.length > limit ? `${raw.slice(0, limit - 1)}…` : raw;
    if (current && current.length + 1 + line.length > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
  return chunks.map((value, i) => ({ name: i === 0 ? name : `${name} (cont.)`, value }));
}
