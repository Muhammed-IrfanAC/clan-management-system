import { describe, it, expect } from 'vitest';
import { leagueWeekRows, thForWeek } from './leagueWeeks';
import type { CoCLeagueHistoryEntry } from '@/lib/coc-api';

const WEEK1 = Date.parse('2026-10-19T05:00:00Z') / 1000;
const WEEK2 = Date.parse('2026-10-26T05:00:00Z') / 1000;
const wars = [
  { at: Date.parse('2026-10-20T10:00:00Z'), th: 16 },
  { at: Date.parse('2026-10-26T10:00:00Z'), th: 17 }, // upgraded at the start of the second week
  { at: Date.parse('2026-10-28T10:00:00Z'), th: 17 },
];

describe('thForWeek', () => {
  it('books a week to the TH held for most of its wars, else the last war before it, else the TH now', () => {
    expect(thForWeek(WEEK1, wars, 17)).toBe(16);
    expect(thForWeek(WEEK2, wars, 17)).toBe(17);
    expect(thForWeek(WEEK2 + 7 * 86400, wars, 18)).toBe(17); // no war that week: the last one before it
    expect(thForWeek(WEEK1 - 7 * 86400, wars, 17)).toBe(17); // no war yet at all: the account's TH now
  });

  it('keeps a week at the old TH when the upgrade came near its end', () => {
    // TH17 most of the week, one TH18 war on the last day — the league was earned as a TH17.
    const late = [
      { at: Date.parse('2026-10-27T10:00:00Z'), th: 17 },
      { at: Date.parse('2026-10-29T10:00:00Z'), th: 17 },
      { at: Date.parse('2026-11-01T10:00:00Z'), th: 18 },
    ];
    expect(thForWeek(WEEK2, late, 18)).toBe(17);
    // a tie goes to the lower TH
    expect(thForWeek(WEEK2, [late[0], late[2]], 18)).toBe(17);
  });
});

describe('leagueWeekRows', () => {
  it('maps each finished week onto a row with the TH held that week', () => {
    const entry = (seasonId: number, tier: number): CoCLeagueHistoryEntry => ({
      leagueSeasonId: seasonId, leagueTrophies: 900, leagueTierId: 105000000 + tier, placement: 3,
      attackWins: 30, attackLosses: 2, attackStars: 0, defenseWins: 20, defenseLosses: 12, defenseStars: 40, maxBattles: 32,
    });
    const rows = leagueWeekRows({ playerTag: '#A', thLevel: 17 }, [entry(WEEK1, 33), entry(WEEK2, 34)], wars);
    expect(rows.map((r) => [r.league_season_id, r.league_tier_id, r.th_level])).toEqual([[WEEK1, 105000033, 16], [WEEK2, 105000034, 17]]);
    expect(rows[0]).toMatchObject({ trophies: 900, placement: 3, attack_wins: 30, defense_stars: 40 });
  });
});
