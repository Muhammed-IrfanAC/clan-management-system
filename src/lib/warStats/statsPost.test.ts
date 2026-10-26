import { describe, it, expect } from 'vitest';
import { formatTally, renderWeeklyStats } from './statsPost';
import { summarizeWars, type StatsAttack } from './summary';
import { weekStarting, type RankedAccountWeek, type RankedWeekSummary } from './rankedWeek';

let order = 0;
/** `triples` 3-stars and `misses` 2-stars by one account, each on its own base. */
function attacks(tag: string, name: string, triples: number, misses: number, th = 16): StatsAttack[] {
  const mk = (stars: number): StatsAttack => {
    order++;
    return {
      order,
      attackerTag: tag,
      attackerName: name,
      attackerPersonId: null,
      attackerTh: th,
      defenderTag: `#D${order}`,
      defenderTh: th,
      stars,
      destruction: stars === 3 ? 100 : 70,
    };
  };
  return [...Array.from({ length: triples }, () => mk(3)), ...Array.from({ length: misses }, () => mk(2))];
}

describe('formatTally', () => {
  it('prints a rounded rate with its counts, or a dash when nothing counted', () => {
    expect(formatTally({ attacks: 3, triples: 2, rate: 2 / 3 })).toBe('67% (2/3)');
    expect(formatTally({ attacks: 0, triples: 0, rate: null })).toBe('—');
  });
});

describe('renderWeeklyStats', () => {
  const summary = summarizeWars([
    {
      id: 'w1',
      attacks: [
        ...attacks('#A', 'Alpha', 5, 0),
        ...attacks('#B', 'B_ravo', 4, 1),
        ...attacks('#C', 'Charlie', 6, 0, 15),
        ...attacks('#D', 'Lucky', 1, 0),
      ],
      members: [{ tag: '#E', name: 'Echo', personId: null, th: 14, attacksAllowed: 2, attacksUsed: 0 }],
    },
  ]);

  it('renders clan totals, the top hitters and the per-TH breakdown, pinging nobody', () => {
    const msg = renderWeeklyStats({ clanName: 'Main', summary, skipped: 0 });
    const embed = msg.embeds![0];
    expect(msg.allowed_mentions).toEqual({ parse: [] });
    expect(msg.content).toBeUndefined();
    expect(embed.title).toBe('📊 Weekly report · Main');
    expect(embed.description).toContain('War stats cover the last 1 war, regular and CWL.');
    expect(embed.fields![0].value).toContain('**Equal TH** 94% (16/17)');
    expect(embed.fields![0].value).toContain('**Missed attacks** 2');
    expect(embed.fields![1].value.split('\n')).toEqual([
      '🥇 **Charlie** TH15 — 100% (6/6)',
      '🥈 **Alpha** TH16 — 100% (5/5)',
      '🥉 **B\\_ravo** TH16 — 80% (4/5)',
    ]);
    expect(embed.fields![2].value).toBe('```\nTH16  91% (10/11)\nTH15  100% (6/6)\n```');
    expect(embed.footer!.text).toBe('War top 5 needs 5+ equal-TH attacks');
  });

  it('names no member for missed attacks', () => {
    const text = JSON.stringify(renderWeeklyStats({ clanName: 'Main', summary, skipped: 0 }));
    expect(text).not.toContain('Echo');
  });

  it('says so when nobody qualifies for the top five', () => {
    const msg = renderWeeklyStats({ clanName: 'Main', summary, skipped: 0, minAttacks: 50 });
    expect(msg.embeds![0].fields![1].value).toBe('_Nobody has 50+ equal-TH attacks in these wars yet._');
  });

  it('notes wars left out of the window', () => {
    const msg = renderWeeklyStats({ clanName: 'Main', summary, skipped: 2 });
    expect(msg.embeds![0].footer!.text).toBe('War top 5 needs 5+ equal-TH attacks · 2 wars left out (attacks only partly recorded)');
  });

  it('drops the per-TH field when no equal-TH attack was made', () => {
    const msg = renderWeeklyStats({ clanName: 'Main', summary: summarizeWars([]), skipped: 0 });
    expect(msg.embeds![0].fields!.map((f) => f.name)).toEqual(['Clan hit rate', 'Top 5 · equal-TH hit rate']);
  });
});

describe('renderWeeklyStats · ranked week', () => {
  const week = weekStarting(1792386000);
  function acct(tag: string, p: Partial<RankedAccountWeek>): RankedAccountWeek {
    return {
      tag,
      name: tag.slice(1),
      th: 16,
      trophies: 400,
      placement: 10,
      tierId: 105000030,
      moved: 0,
      attacks: 0,
      offenceComplete: false,
      stars: 0,
      triples: 0,
      avgStars: null,
      avgDestruction: null,
      defences: 0,
      defenceWins: 0,
      starsConceded: 0,
      avgConceded: null,
      ...p,
    };
  }
  const ranked: RankedWeekSummary = {
    week,
    members: 30,
    played: 2,
    promoted: 1,
    demoted: 0,
    accounts: [
      acct('#Ace', { attacks: 12, offenceComplete: true, stars: 34, triples: 10, avgStars: 34 / 12, avgDestruction: 97 }),
      acct('#Wall', { defences: 6, defenceWins: 2, starsConceded: 4, avgConceded: 4 / 6 }),
    ],
  };

  it('leads with the league week, then the war section', () => {
    const msg = renderWeeklyStats({ clanName: 'Main', summary: summarizeWars([]), skipped: 0, ranked: { summary: ranked, unread: 1 } });
    const embed = msg.embeds![0];
    expect(embed.description!.split('\n')[0]).toBe('League week <t:1792386000:d> – <t:1792990800:d>.');
    expect(embed.fields!.map((f) => f.name)).toEqual([
      'League week',
      'Top 5 offence · Dragon+',
      'Top 5 defence · Dragon+',
      'Clan hit rate',
      'Top 5 · equal-TH hit rate',
    ]);
    expect(embed.fields![0].value).toBe('**Played** 2 of 30 · **Promoted** 1 · **Demoted** 0');
    expect(embed.fields![1].value).toBe('🥇 **Ace** TH16 · Dragon 30 — 2.83★ avg · 10/12 triples');
    expect(embed.fields![2].value).toBe('🥇 **Wall** TH16 · Dragon 30 — 0.67★ conceded per defence (6)');
    expect(embed.footer!.text).toBe(
      "Ranked top 5 needs 4+ attacks or 3+ defences · 1 account couldn't be read · War top 5 needs 5+ equal-TH attacks",
    );
  });

  it('ranks only accounts that played the week in Dragon or above', () => {
    const low = {
      ...ranked,
      accounts: [
        acct('#Titan', { tierId: 105000027, attacks: 6, offenceComplete: true, stars: 18, triples: 6, avgStars: 3, defences: 4, avgConceded: 0 }),
        acct('#Dragon', { tierId: 105000028, attacks: 6, offenceComplete: true, stars: 12, triples: 2, avgStars: 2, defences: 4, avgConceded: 2 }),
      ],
    };
    const fields = renderWeeklyStats({ clanName: 'Main', summary: null, skipped: 0, ranked: { summary: low, unread: 0 } }).embeds![0].fields!;
    expect(fields[1].value).toBe('🥇 **Dragon** TH16 · Dragon 28 — 2.00★ avg · 2/6 triples');
    expect(fields[2].value).toBe('🥇 **Dragon** TH16 · Dragon 28 — 2.00★ conceded per defence (4)');
  });

  it('posts the league week alone when the clan has no wars', () => {
    const msg = renderWeeklyStats({ clanName: 'Main', summary: null, skipped: 0, ranked: { summary: { ...ranked, accounts: [] }, unread: 0 } });
    const embed = msg.embeds![0];
    expect(embed.description).not.toContain('War stats');
    expect(embed.fields!.map((f) => f.value).slice(1)).toEqual([
      '_Nobody in Dragon+ has 4+ ranked attacks this week._',
      '_Nobody in Dragon+ has 3+ ranked defences this week._',
    ]);
    expect(embed.footer!.text).toBe('Ranked top 5 needs 4+ attacks or 3+ defences');
  });
});
