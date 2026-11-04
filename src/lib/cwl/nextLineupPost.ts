/**
 * The "next war lineup" Discord post — the pure renderer (nextLineupPostNotify.ts is the DB/send half).
 *
 * One message per clan, for the next war the planner can still change. The lineup is a monospace
 * table in an embed (position, name, TH, the TH of the mirror base they hit); the @-mentions live in
 * the plain CONTENT, because a mention inside an embed renders but never notifies — and telling
 * people they play is the point of the post. Expected stars are deliberately left out: they are the
 * planner's working, not something a player needs, and a number next to a name reads as a verdict.
 *
 * Pure, so the preview the dashboard shows is byte-for-byte what gets posted.
 */
import type { DiscordEmbedField, DiscordMessage } from '@/lib/discord/types';

const COLOR_OK = 0x22c55e;
const COLOR_WARN = 0xf59e0b;
const FIELD_LIMIT = 1024;
const NAME_WIDTH = 16;

export interface LineupPostSlot {
  mapPosition: number;
  name: string;
  thLevel: number;
  /** The mirror base's TH once the opponent is drawn; null before. */
  enemyTh: number | null;
  /** Discord id to ping, or null to name them without a ping. */
  mentionId: string | null;
}

export interface LineupPostInput {
  clanName: string;
  seasonLabel: string;
  roundNumber: number;
  opponentName: string | null;
  enemyKnown: boolean;
  warSize: number;
  lineup: LineupPostSlot[];
  bench: string[];
  /** Mention the players in the lineup. */
  ping: boolean;
  /**
   * The in-game edits from the lineup that exists now (swaps.ts). Absent or `fromRound: null` when
   * there is no lineup to swap from yet; then nothing is appended.
   */
  swaps?: { fromRound: number | null; fromCurrentPrep: boolean; out: string[]; in: string[] };
}

/** Strip the characters that would break a code fence or a mention. */
function clean(text: string): string {
  return text.replace(/[`@]/g, '').replace(/\s+/g, ' ').trim();
}

/** Outside a code fence, escape Discord markdown so a name like `__x__` or `*Bob*` prints as written. */
function md(text: string): string {
  return clean(text).replace(/([\\*_~|>#-])/g, '\\$1');
}

function padName(name: string): string {
  const n = clean(name);
  const cut = [...n].length > NAME_WIDTH ? [...n].slice(0, NAME_WIDTH - 1).join('') + '…' : n;
  return cut + ' '.repeat(Math.max(0, NAME_WIDTH - [...cut].length));
}

/**
 * Split fenced lines into as few embed fields as Discord's per-field limit allows, with the rows
 * spread EVENLY across them — a greedy fill left a 30-man lineup as 29 rows and a lone straggler.
 */
function fencedFields(title: string, lines: string[]): DiscordEmbedField[] {
  if (!lines.length) return [];
  const fits = (chunk: string[]) => ('```\n' + chunk.join('\n') + '\n```').length <= FIELD_LIMIT;
  for (let parts = 1; parts <= lines.length; parts++) {
    const size = Math.ceil(lines.length / parts);
    const chunks: string[][] = [];
    for (let i = 0; i < lines.length; i += size) chunks.push(lines.slice(i, i + size));
    if (chunks.every(fits)) {
      return chunks.map((chunk, i) => ({
        name: i === 0 ? title : `${title} (cont.)`,
        value: '```\n' + chunk.join('\n') + '\n```',
      }));
    }
  }
  return [];
}

export function renderLineupPost(input: LineupPostInput): DiscordMessage {
  const { clanName, seasonLabel, roundNumber, opponentName, enemyKnown, warSize, lineup, bench, ping } = input;
  // Markdown-escaped for the content line; embed titles render no markdown, so they get it plain.
  const vs = enemyKnown && opponentName ? ` vs ${md(opponentName)}` : '';
  const vsPlain = enemyKnown && opponentName ? ` vs ${clean(opponentName)}` : '';

  const rows = lineup
    .slice()
    .sort((a, b) => a.mapPosition - b.mapPosition)
    .map((s) => {
      const pos = String(s.mapPosition).padStart(2, ' ');
      const target = s.enemyTh != null ? `→ TH${s.enemyTh}` : '';
      return `${pos}  ${padName(s.name)} TH${String(s.thLevel).padStart(2, ' ')}  ${target}`.trimEnd();
    });

  const fields: DiscordEmbedField[] = [...fencedFields(`Lineup — ${lineup.length}/${warSize}`, rows)];
  if (bench.length) {
    const value = bench.map(md).join(', ');
    fields.push({ name: `Sitting out — ${bench.length}`, value: value.length > FIELD_LIMIT ? value.slice(0, FIELD_LIMIT - 1) + '…' : value });
  }
  if (input.swaps && input.swaps.fromRound != null) {
    const { fromRound, fromCurrentPrep, out, in: incoming } = input.swaps;
    const list = (names: string[]) => {
      const value = names.length ? names.map(md).join(', ') : '—';
      return value.length > FIELD_LIMIT ? value.slice(0, FIELD_LIMIT - 1) + '…' : value;
    };
    const from = fromCurrentPrep ? `the war ${fromRound} lineup set in game` : `war ${fromRound}`;
    if (out.length + incoming.length === 0) {
      fields.push({ name: `Changes from ${from}`, value: 'None — same lineup.' });
    } else {
      fields.push({ name: `⬇️ Out (from ${from}) — ${out.length}`, value: list(out) });
      fields.push({ name: `⬆️ In — ${incoming.length}`, value: list(incoming) });
    }
  }

  const short = Math.max(0, warSize - lineup.length);
  const description = [
    enemyKnown
      ? 'Hit your **mirror** — the enemy base with your number.'
      : 'Opponent not drawn yet — this lineup is provisional and may change.',
    short ? `⚠️ **${short} short** of a full lineup.` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const mentions = ping ? [...new Set(lineup.map((s) => s.mentionId).filter((id): id is string => !!id))] : [];
  const content = [
    `**${md(clanName)} · CWL ${md(seasonLabel)} · War ${roundNumber}${vs}**`,
    mentions.length ? `You're up: ${mentions.map((id) => `<@${id}>`).join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    content,
    allowed_mentions: { parse: [], users: mentions },
    embeds: [
      {
        title: `War ${roundNumber} lineup${vsPlain}`,
        description,
        color: short ? COLOR_WARN : COLOR_OK,
        fields,
        footer: { text: 'Kept up to date until the war starts' },
      },
    ],
  };
}
