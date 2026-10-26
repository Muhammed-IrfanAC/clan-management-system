import { describe, it, expect } from 'vitest';
import type { CoCBattle, CoCLeagueHistoryEntry } from '@/lib/coc-api';
import {
  awaitingResults,
  lastEndedWeek,
  summarizeRankedWeek,
  topDefence,
  topOffence,
  weekStarting,
  weeklyPostDue,
  type RankedAccountInput,
} from './rankedWeek';

const WEEK = weekStarting(1792386000); // Mon 19 Oct 2026 05:00 UTC → Mon 26 Oct 05:00 UTC

function entry(p: Partial<CoCLeagueHistoryEntry> = {}): CoCLeagueHistoryEntry {
  return {
    leagueSeasonId: WEEK.seasonId,
    leagueTrophies: 400,
    leagueTierId: 105000020,
    placement: 30,
    attackWins: 0,
    attackLosses: 0,
    attackStars: 0,
    defenseWins: 0,
    defenseLosses: 0,
    defenseStars: 0,
    maxBattles: 12,
    ...p,
  };
}

/** A battle at `iso` (extended ISO, converted to the API's compact form). */
function battle(iso: string, stars: number, p: Partial<CoCBattle> = {}): CoCBattle {
  return {
    battleType: 'ranked',
    attack: true,
    opponentPlayerTag: '#OPP',
    opponentName: 'opp',
    opponentTownHallLevel: 16,
    stars,
    destructionPercentage: stars === 3 ? 100 : 80,
    battleTime: 150,
    battleTimestamp: iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, '.000Z'),
    ...p,
  };
}

function account(tag: string, p: Partial<RankedAccountInput> = {}): RankedAccountInput {
  return { tag, name: `Name${tag}`, th: 16, currentTierId: 105000020, week: null, battles: [], ...p };
}

/** `stars` as attacks inside the week, one hour apart. */
function attacksIn(stars: number[]): CoCBattle[] {
  return stars.map((s, i) => battle(new Date(WEEK.start.getTime() + (i + 1) * 3600_000).toISOString(), s));
}

describe('week arithmetic', () => {
  it('finds the week that ended most recently', () => {
    expect(lastEndedWeek(new Date('2026-10-26T06:00:00Z')).seasonId).toBe(1792386000);
    expect(lastEndedWeek(new Date('2026-10-26T04:59:59Z')).seasonId).toBe(1792386000 - 604800);
    expect(lastEndedWeek(new Date('2026-11-02T05:00:00Z')).seasonId).toBe(1792990800);
    // Before the anchor too.
    expect(lastEndedWeek(new Date('2026-09-01T00:00:00Z')).start.toISOString()).toBe('2026-08-24T05:00:00.000Z');
  });

  it('is due from half an hour after the reset until a day after', () => {
    expect(weeklyPostDue(new Date('2026-10-26T05:20:00Z'), WEEK)).toBe(false);
    expect(weeklyPostDue(new Date('2026-10-26T05:30:00Z'), WEEK)).toBe(true);
    expect(weeklyPostDue(new Date('2026-10-27T04:59:00Z'), WEEK)).toBe(true);
    expect(weeklyPostDue(new Date('2026-10-27T05:00:00Z'), WEEK)).toBe(false);
  });

  it('waits up to three hours for the first results', () => {
    expect(awaitingResults(new Date('2026-10-26T07:59:00Z'), WEEK, 0)).toBe(true);
    expect(awaitingResults(new Date('2026-10-26T07:59:00Z'), WEEK, 1)).toBe(false);
    expect(awaitingResults(new Date('2026-10-26T08:00:00Z'), WEEK, 0)).toBe(false);
  });
});

describe('summarizeRankedWeek', () => {
  it('counts who played, promotions and demotions', () => {
    const s = summarizeRankedWeek(
      [
        account('#UP', { week: entry(), currentTierId: 105000021 }),
        account('#DOWN', { week: entry(), currentTierId: 105000019 }),
        account('#SAME', { week: entry() }),
        account('#UNKNOWN', { week: entry(), currentTierId: null }),
        account('#IDLE'),
        account('#OLD', { week: entry({ leagueSeasonId: WEEK.seasonId - 604800 }) }),
      ],
      WEEK,
    );
    expect(s).toMatchObject({ members: 6, played: 4, promoted: 1, demoted: 1 });
    expect(s.accounts.map((a) => [a.tag, a.moved])).toEqual([['#UP', 1], ['#DOWN', -1], ['#SAME', 0], ['#UNKNOWN', null]]);
  });

  it('takes offence from the ranked attacks inside the week only', () => {
    const s = summarizeRankedWeek(
      [
        account('#A', {
          week: entry({ attackWins: 3 }),
          battles: [
            ...attacksIn([3, 2, 3]),
            battle('2026-10-19T04:59:00Z', 1), // the week before
            battle('2026-10-26T05:00:00Z', 1), // the week after
            battle('2026-10-20T10:00:00Z', 0, { battleType: 'homeVillage' }),
            battle('2026-10-20T11:00:00Z', 3, { attack: false }),
          ],
        }),
      ],
      WEEK,
    );
    expect(s.accounts[0]).toMatchObject({ attacks: 3, offenceComplete: true, stars: 8, triples: 2, avgDestruction: 280 / 3 });
    expect(s.accounts[0].avgStars).toBeCloseTo(8 / 3);
  });

  it('marks offence incomplete when the log has rolled past part of the week', () => {
    const s = summarizeRankedWeek(
      [
        account('#ROLLED', { week: entry({ attackWins: 4 }), battles: attacksIn([3, 3, 3]) }),
        account('#NOLOG', { week: entry({ attackWins: 1 }), battles: null }),
      ],
      WEEK,
    );
    expect(s.accounts.map((a) => [a.offenceComplete, a.avgStars])).toEqual([[false, null], [false, null]]);
  });

  it('takes defence from the official history', () => {
    const s = summarizeRankedWeek([account('#D', { week: entry({ defenseWins: 1, defenseLosses: 3, defenseStars: 6 }) })], WEEK);
    expect(s.accounts[0]).toMatchObject({ defences: 4, defenceWins: 1, starsConceded: 6, avgConceded: 1.5 });
  });
});

describe('top five', () => {
  const s = summarizeRankedWeek(
    [
      account('#ACE', { week: entry({ attackWins: 4 }), battles: attacksIn([3, 3, 3, 3]) }),
      account('#GOOD', { week: entry({ attackWins: 5 }), battles: attacksIn([3, 3, 3, 2, 3]) }),
      account('#TIE', { week: entry({ attackWins: 5 }), battles: attacksIn([3, 3, 3, 3, 2]) }),
      account('#FEW', { week: entry({ attackWins: 2 }), battles: attacksIn([3, 3]) }),
      account('#ROLLED', { week: entry({ attackWins: 6 }), battles: attacksIn([3, 3, 3, 3, 3]) }),
      account('#WALL', { week: entry({ defenseWins: 2, defenseLosses: 2, defenseStars: 2 }) }),
      account('#WALL2', { week: entry({ defenseWins: 1, defenseLosses: 5, defenseStars: 3 }) }),
      account('#ONE', { week: entry({ defenseWins: 1, defenseLosses: 1, defenseStars: 0 }) }),
      account('#OPEN', { week: entry({ defenseLosses: 3, defenseStars: 9 }) }),
    ],
    WEEK,
  );

  it('ranks offence by average stars, needing a minimum and a complete log', () => {
    expect(topOffence(s.accounts).map((a) => a.tag)).toEqual(['#ACE', '#GOOD', '#TIE']);
    expect(topOffence(s.accounts, { minAttacks: 1 }).map((a) => a.tag)).toEqual(['#ACE', '#FEW', '#GOOD', '#TIE']);
  });

  it('ranks only from a minimum league when asked', () => {
    const t = summarizeRankedWeek(
      [
        account('#LOW', { week: entry({ leagueTierId: 105000027, attackWins: 4, defenseLosses: 3 }), battles: attacksIn([3, 3, 3, 3]) }),
        account('#HIGH', { week: entry({ leagueTierId: 105000028, attackWins: 4, defenseLosses: 3, defenseStars: 9 }), battles: attacksIn([1, 1, 1, 1]) }),
      ],
      WEEK,
    );
    expect(topOffence(t.accounts, { minTier: 28 }).map((a) => a.tag)).toEqual(['#HIGH']);
    expect(topDefence(t.accounts, { minTier: 28 }).map((a) => a.tag)).toEqual(['#HIGH']);
    expect(topOffence(t.accounts).map((a) => a.tag)).toEqual(['#LOW', '#HIGH']);
  });

  it('ranks defence by fewest stars conceded, then by defences held', () => {
    expect(topDefence(s.accounts).map((a) => a.tag)).toEqual(['#WALL2', '#WALL', '#OPEN']);
    expect(topDefence(s.accounts, { minDefences: 1, limit: 1 }).map((a) => a.tag)).toEqual(['#ONE']);
  });
});
