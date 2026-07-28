import type { DiscordEmbedField, DiscordMessage } from '@/lib/discord';

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
 *   B. renderTransferCalls   → one message per SOURCE clan, at `transfers_pending`, sent to that
 *                              clan's own channel. ONLY the accounts that must move in-game, and the
 *                              one message here that legitimately @-mentions people, because it is
 *                              asking them to do something. Split by source rather than sent
 *                              family-wide for the same reason the rosters are: a member reads their
 *                              own clan's channel, and "you are in A, move to B" is a different
 *                              instruction for every A.
 *   C. renderLeadershipDigest→ leadership channel. Fill per clan at a glance. Earns its place by
 *                              surfacing the priority waterfall's failure mode — a low-priority clan
 *                              left short of a full lineup — where leaders will actually see it,
 *                              instead of only on the roster board.
 *
 * Two format rules learned the hard way, and the reason this file looks the way it does:
 *
 *   1. A MENTION INSIDE AN EMBED DOES NOT NOTIFY. Discord renders `<@id>` in an embed as a nice blue
 *      pill, so it looks like it worked, but no notification is delivered. Only mentions in a
 *      message's top-level `content` ping. Template B is therefore plain content with NO embed — its
 *      entire job is the notification, so it cannot afford a decoration that silently eats it.
 *   2. PER-PLAYER DETAIL IS NOISE. Name plus town hall is what a player scans a roster for; league
 *      tier per line turned a 30-name list into a wall. Rosters render as aligned monospace columns
 *      instead — no bullets, no separators, no punctuation between fields.
 */

const COLOR_OK = 0x22c55e;
const COLOR_WARN = 0xf59e0b;
const COLOR_INFO = 0x3b82f6;

/** Discord's per-field value limit. Long lists are split across fields rather than truncated. */
const FIELD_LIMIT = 1024;

/**
 * One allocated account, as the board knows it. Deliberately thin: league tier decides ELIGIBILITY
 * (see `constraints.ts`) but printing it per line only crowds the roster, so it is not carried here.
 */
export interface RosterEntry {
  playerTag: string;
  name: string;
  thLevel: number;
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
  // One width across BOTH blocks so the lineup and the bench read as a single continuous table.
  const width = nameWidth(sorted);

  const fields: DiscordEmbedField[] = [
    ...fieldsFrom(`Lineup — ${lineup.length}/${warSize}`, rosterLines(lineup, width), { fence: true }),
    ...fieldsFrom(`Bench — ${bench.length}`, rosterLines(bench, width), { fence: true }),
  ];
  if (fields.length === 0) {
    fields.push({ name: 'Roster', value: 'No accounts allocated to this clan yet.' });
  }

  return {
    allowed_mentions: { parse: [] }, // informational; nobody gets pinged by a roster list
    embeds: [
      {
        title: `${clanName} · CWL ${seasonLabel}`,
        description: short ? `⚠️ **${short} short** of a full lineup.` : undefined,
        color: short ? COLOR_WARN : COLOR_OK,
        fields,
        footer: {
          text: bench.length
            ? 'Bench: stay in the clan all week — you can be called up any round · kept up to date'
            : 'Kept up to date as the roster changes',
        },
      },
    ],
  };
}

/** One required in-game move, ready to render. `mentionId` null = name them, don't ping them. */
export interface TransferMove {
  name: string;
  playerTag: string;
  mentionId: string | null;
  /** Where they are now. Null = not in a family clan we can route a message to. */
  fromClanId: string | null;
  fromClanName: string | null;
  toClanName: string;
}

/** One transfer message and the clan channel it belongs in. `fromClanId` null → family-wide. */
export interface TransferCallGroup {
  fromClanId: string | null;
  fromClanName: string | null;
  message: DiscordMessage;
}

/** Discord's limit on a message's top-level content. */
const CONTENT_LIMIT = 2000;

/**
 * Template B — the moves that must happen before sign-up. The messages that ping.
 *
 * One per source clan, because that is the channel the people being asked to move actually read, and
 * because the instruction differs per source: everyone in a given message is leaving the same clan,
 * so the message can say it once and each line only has to name a destination. Movers we cannot place
 * in a family clan fall into a trailing null group that goes family-wide.
 *
 * Returns an EMPTY LIST when nothing has to move. There is no "all clear" message: it would have to
 * be sent to every clan channel to be consistent, and a ping-shaped message that says "do nothing"
 * teaches people to ignore the next one.
 *
 * PLAIN CONTENT, NO EMBED, on purpose: a mention inside an embed renders as a mention but never
 * notifies anyone. Every mover is named on their own line, so the ping and the instruction are the
 * same line — there is no separate wall of `@` at the top to reconcile against a list below.
 */
export function renderTransferCalls(input: { seasonLabel: string; moves: TransferMove[] }): TransferCallGroup[] {
  const { seasonLabel, moves } = input;

  // Grouped in first-seen order, with the unrouted group forced last — it is the exception, and it
  // reads as a footnote rather than as the headline.
  const groups = new Map<string, TransferMove[]>();
  for (const move of moves) {
    const key = move.fromClanId ?? '';
    groups.set(key, [...(groups.get(key) || []), move]);
  }
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : 0));

  return ordered.map(([key, group]) => ({
    fromClanId: key || null,
    fromClanName: group[0].fromClanName,
    message: renderTransferGroup(seasonLabel, group[0].fromClanName, group),
  }));
}

function renderTransferGroup(seasonLabel: string, fromClanName: string | null, moves: TransferMove[]): DiscordMessage {
  // Restrict allowed_mentions to exactly the movers' ids, so no other name in the message — a clan
  // name, a player named like a role — can resolve into a ping.
  const mentionIds = moves.map((m) => m.mentionId).filter((id): id is string => !!id);
  const lines = moves.map((m) => {
    const who = m.mentionId ? `<@${m.mentionId}> **${m.name}**` : `**${m.name}**`;
    return `${who} → **${m.toClanName}**`;
  });

  const count = `${moves.length} account${moves.length === 1 ? '' : 's'}`;
  const head = fromClanName
    ? `📦 **CWL ${seasonLabel}** — ${count} moving out of **${fromClanName}**`
    : `📦 **CWL ${seasonLabel}** — ${count} that ${moves.length === 1 ? 'needs' : 'need'} to join a clan for CWL`;
  const tail = fromClanName
    ? 'Move before sign-up closes. Everyone else in this clan stays put — leadership ticks each move off as it lands.'
    : 'Move before sign-up closes — leadership ticks each move off as it lands.';

  return {
    content: [head, '', ...fitLines(lines, CONTENT_LIMIT - head.length - tail.length - 6), '', tail].join('\n'),
    allowed_mentions: { users: mentionIds },
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
    const fill = `${c.lineupCount}/${c.warSize}`.padStart(5);
    const bench = c.benchCount ? `+${c.benchCount}` : '  ';
    return `${clean(c.clanName).padEnd(width)}  ${fill}  ${bench.padEnd(3)}${short ? ` SHORT ${short}` : ''}`.trimEnd();
  });

  const shortClans = clans.filter((c) => c.lineupCount < c.warSize).length;

  return {
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: `CWL ${seasonLabel} — roster formed`,
        description: rows.length ? fence(rows.join('\n')) : 'No clans in this season.',
        color: shortClans ? COLOR_WARN : COLOR_INFO,
        fields: [
          {
            name: 'Status',
            value: [
              shortClans
                ? `⚠️ **${shortClans}** clan${shortClans === 1 ? '' : 's'} short of a full lineup — the pool ran out before the last clan filled.`
                : '✅ Every clan has a full lineup.',
              `${unassigned} eligible account${unassigned === 1 ? '' : 's'} unassigned · ${pendingMoves} move${pendingMoves === 1 ? '' : 's'} still pending.`,
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

/** Widest name in the set, so every column below it lines up. */
function nameWidth(entries: RosterEntry[]): number {
  return Math.max(6, ...entries.map((e) => clean(e.name).length));
}

/**
 * `NN  Name          TH` — a table, not a sentence. Aligned columns are what make a 30-name list
 * scannable; bullets and separators are what made the previous version feel like a wall.
 */
function rosterLines(entries: RosterEntry[], width: number): string[] {
  return entries.map((e, i) =>
    `${String(i + 1).padStart(2)}  ${clean(e.name).padEnd(width)}  ${e.thLevel ? `TH${e.thLevel}` : '  —'}`,
  );
}

/** Backticks in an in-game name would break out of the code fence and mangle the whole block. */
function clean(text: string): string {
  return text.replace(/`/g, "'");
}

function fence(body: string): string {
  return `\`\`\`\n${body}\n\`\`\``;
}

/**
 * Pack lines into as many fields as they need. A 30-player lineup is roughly 1200 characters, which
 * silently overflows Discord's 1024-char field limit — and the failure mode of overflowing is the
 * whole message being rejected, i.e. no roster at all. Splitting keeps every name.
 */
function fieldsFrom(
  name: string,
  lines: string[],
  opts: { fence?: boolean; limit?: number } = {},
): DiscordEmbedField[] {
  if (lines.length === 0) return [];
  const limit = (opts.limit ?? FIELD_LIMIT) - (opts.fence ? 8 : 0); // ```\n … \n```
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
  return chunks.map((value, i) => ({
    name: i === 0 ? name : `${name} (cont.)`,
    value: opts.fence ? fence(value) : value,
  }));
}

/**
 * Trim a line list to a character budget, saying how many were dropped rather than silently cutting.
 * Only bites on an implausibly large transfer list; the roster board is the full record either way.
 */
function fitLines(lines: string[], budget: number): string[] {
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const note = `…and ${lines.length - kept.length} more — see the roster board.`;
    if (used + line.length + 1 + note.length > budget) return [...kept, note];
    kept.push(line);
    used += line.length + 1;
  }
  return kept;
}
