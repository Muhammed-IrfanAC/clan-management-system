import type { DiscordEmbedField, DiscordMessage } from '@/lib/discord/types';
import { discordTs } from '@/lib/discord/format';
import { majorFloorTier, tierLabel } from '@/lib/cwl/leagues';
import { tierOrdinal, topDefence, topOffence, type RankedAccountWeek, type RankedWeekSummary } from './rankedWeek';
import { topHitters, type HitTally, type WarStatsSummary } from './summary';

/**
 * PURE renderer for the weekly stats post. `weeklyPost.ts` is the DB/send half.
 *
 * One embed per clan, in two parts. The Ranked League week that just ended: who played, who moved
 * tier, and the top five in offence (average stars per ranked attack) and defence (fewest stars
 * conceded per defence). Then war performance over the clan's last wars: the clan's hit rates, the
 * top five by equal-TH hit rate, and the equal-TH rate per town hall level. Either part is left out
 * when there is nothing to show for it.
 *
 * Missed war attacks appear only as a clan total — naming the members who missed is the strike
 * system's job, and this post is meant to celebrate rather than call people out. For the same reason
 * it pings nobody.
 *
 * Every war rate excludes hits on bases that were already 3-starred (`attackClass.ts`), which the
 * description says in a line, since a member comparing this against another bot's number needs to
 * know why the two differ.
 */

const COLOR_STATS = 0x3b82f6;
const MEDALS = ['🥇', '🥈', '🥉'];

export type WeeklyStatsPost = {
  clanName: string;
  /** War performance over the window; null when the clan has no wars in it. */
  summary: WarStatsSummary | null;
  /** Wars inside the window left out because their attacks were only partly recorded. */
  skipped: number;
  /** The Ranked League week; null to leave the section out. */
  ranked?: { summary: RankedWeekSummary; unread: number } | null;
  /** Requirement for a place in the war top five, passed to `topHitters`. */
  minAttacks?: number;
};

/** Requirements for the ranked top fives. */
const MIN_RANKED_ATTACKS = 4;
const MIN_DEFENCES = 3;
/**
 * The ranked top fives only rank accounts that played the week in Dragon or above: stars are easier
 * to come by in the low leagues, so a single list across every league is topped by whoever fights the
 * weakest bases. The league line (played / promoted / demoted) still covers the whole clan.
 */
const RANKED_MIN_TIER = majorFloorTier('dragon');
const RANKED_BAND = 'Dragon+';

/** Player names are free text, and a stray `*` or `_` would turn the rest of the line bold. */
function escapeMarkdown(s: string): string {
  return s.replace(/([*_`~|\\>])/g, '\\$1');
}

/** `72% (18/25)`, or an em dash when nothing was counted. */
export function formatTally(t: HitTally): string {
  if (t.rate == null) return '—';
  return `${Math.round(t.rate * 100)}% (${t.triples}/${t.attacks})`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** `🥇 **Name** TH16 — <stat>`, medals for the first three. */
function rankLines<T extends { tag: string; name: string | null; th: number | null }>(
  rows: T[],
  stat: (row: T) => string,
  empty: string,
  badge: (row: T) => string = () => '',
): string {
  if (!rows.length) return empty;
  return rows
    .map((r, i) => {
      const th = r.th ? ` TH${r.th}` : '';
      return `${MEDALS[i] ?? `${i + 1}.`} **${escapeMarkdown(r.name || r.tag)}**${th}${badge(r)} — ${stat(r)}`;
    })
    .join('\n');
}

function rankedFields(r: RankedWeekSummary): DiscordEmbedField[] {
  const league = (a: RankedAccountWeek) => ` · ${tierLabel(tierOrdinal(a))}`;
  const week = [`**Played** ${r.played} of ${r.members}`, `**Promoted** ${r.promoted}`, `**Demoted** ${r.demoted}`].join(' · ');
  const offence = rankLines(
    topOffence(r.accounts, { minAttacks: MIN_RANKED_ATTACKS, minTier: RANKED_MIN_TIER }),
    (a) => `${a.avgStars!.toFixed(2)}★ avg · ${a.triples}/${a.attacks} triples`,
    `_Nobody in ${RANKED_BAND} has ${MIN_RANKED_ATTACKS}+ ranked attacks this week._`,
    league,
  );
  const defence = rankLines(
    topDefence(r.accounts, { minDefences: MIN_DEFENCES, minTier: RANKED_MIN_TIER }),
    (a) => `${a.avgConceded!.toFixed(2)}★ conceded per defence (${a.defences})`,
    `_Nobody in ${RANKED_BAND} has ${MIN_DEFENCES}+ ranked defences this week._`,
    league,
  );
  return [
    { name: 'League week', value: week, inline: false },
    { name: `Top 5 offence · ${RANKED_BAND}`, value: offence, inline: false },
    { name: `Top 5 defence · ${RANKED_BAND}`, value: defence, inline: false },
  ];
}

function warFields(s: WarStatsSummary, minAttacks: number): DiscordEmbedField[] {
  const clan = [
    `**Overall** ${formatTally(s.clan.overall)}`,
    `**Equal TH** ${formatTally(s.clan.equal)}`,
    `**Hitting up** ${formatTally(s.clan.up)}`,
    `**Hitting down** ${formatTally(s.clan.down)}`,
    `**Loot hits excluded** ${s.clan.dead}`,
    `**Missed attacks** ${s.clan.missed}`,
  ].join('\n');

  const top = rankLines(
    topHitters(s.accounts, { minAttacks }),
    (a) => formatTally(a.equal),
    `_Nobody has ${minAttacks}+ equal-TH attacks in these wars yet._`,
  );

  const fields: DiscordEmbedField[] = [
    { name: 'Clan hit rate', value: clan, inline: false },
    { name: 'Top 5 · equal-TH hit rate', value: top, inline: false },
  ];
  if (s.equalByTh.length) {
    // Monospace so the percentages line up under each other.
    const rows = s.equalByTh.map(({ th, tally }) => `${`TH${th}`.padEnd(5)} ${formatTally(tally)}`);
    fields.push({ name: 'Equal TH by town hall', value: `\`\`\`\n${rows.join('\n')}\n\`\`\``, inline: false });
  }
  return fields;
}

export function renderWeeklyStats(p: WeeklyStatsPost): DiscordMessage {
  const { summary: s, ranked } = p;
  const minAttacks = p.minAttacks ?? 5;

  const description: string[] = [];
  const fields: DiscordEmbedField[] = [];
  const footer: string[] = [];

  if (ranked) {
    const { start, end } = ranked.summary.week;
    description.push(`League week ${discordTs(start.toISOString(), 'd')} – ${discordTs(end.toISOString(), 'd')}.`);
    fields.push(...rankedFields(ranked.summary));
    footer.push(`Ranked top 5 needs ${MIN_RANKED_ATTACKS}+ attacks or ${MIN_DEFENCES}+ defences`);
    if (ranked.unread) footer.push(`${plural(ranked.unread, 'account')} couldn't be read`);
  }
  if (s) {
    description.push(
      `War stats cover the last ${plural(s.wars, 'war')}, regular and CWL. ` +
        `Hits on a base that was already 3-starred don't count toward hit rate.`,
    );
    fields.push(...warFields(s, minAttacks));
    footer.push(`War top 5 needs ${minAttacks}+ equal-TH attacks`);
  }
  if (p.skipped) footer.push(`${plural(p.skipped, 'war')} left out (attacks only partly recorded)`);

  return {
    embeds: [
      {
        title: `📊 Weekly report · ${p.clanName}`,
        description: description.join('\n'),
        color: COLOR_STATS,
        fields,
        footer: { text: footer.join(' · ') },
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
