import { describe, it, expect } from 'vitest';
import { isWarComplete, matchupOf, summarizeWars, topHitters, type StatsAttack, type StatsWar, type WarSlot } from './summary';

function hit(
  order: number,
  attackerTag: string,
  defenderTag: string,
  stars: number,
  p: Partial<StatsAttack> = {},
): StatsAttack {
  return {
    order,
    attackerTag,
    attackerName: `Name${attackerTag}`,
    attackerPersonId: `person${attackerTag}`,
    attackerTh: 16,
    defenderTag,
    defenderTh: 16,
    stars,
    destruction: stars === 3 ? 100 : 60,
    ...p,
  };
}

function war(id: string, attacks: StatsAttack[], members?: WarSlot[]): StatsWar {
  return { id, attacks, members };
}

function slot(tag: string, attacksUsed: number, p: Partial<WarSlot> = {}): WarSlot {
  return { tag, name: `Name${tag}`, personId: `person${tag}`, th: 16, attacksAllowed: 2, attacksUsed, ...p };
}

describe('matchupOf', () => {
  it('classifies equal, up and down, and unknown as null', () => {
    expect(matchupOf({ attackerTh: 16, defenderTh: 16 })).toBe('equal');
    expect(matchupOf({ attackerTh: 15, defenderTh: 16 })).toBe('up');
    expect(matchupOf({ attackerTh: 16, defenderTh: 15 })).toBe('down');
    expect(matchupOf({ attackerTh: null, defenderTh: 15 })).toBeNull();
  });
});

describe('summarizeWars', () => {
  it('keeps a post-clear loot hit out of the hit rate', () => {
    const s = summarizeWars([
      war('w1', [hit(1, '#A', '#D1', 3), hit(2, '#B', '#D2', 3), hit(3, '#A', '#D2', 1)]),
    ]);
    const a = s.accounts.find((x) => x.tag === '#A')!;
    expect(a.overall).toEqual({ attacks: 1, triples: 1, rate: 1 });
    expect(a).toMatchObject({ totalAttacks: 2, dead: 1, newStars: 3 });
    expect(s.clan).toMatchObject({ totalAttacks: 3, dead: 1, newStars: 6 });
    expect(s.clan.overall.rate).toBe(1);
  });

  it('still counts a failed cleanup as a miss', () => {
    const s = summarizeWars([war('w1', [hit(1, '#A', '#D1', 2), hit(2, '#B', '#D1', 2)])]);
    const b = s.accounts.find((x) => x.tag === '#B')!;
    expect(b.overall).toEqual({ attacks: 1, triples: 0, rate: 0 });
    expect(b.newStars).toBe(0);
  });

  it('splits hit rate by matchup', () => {
    const s = summarizeWars([
      war('w1', [
        hit(1, '#A', '#D1', 3),
        hit(2, '#A', '#D2', 2, { defenderTh: 17 }),
        hit(3, '#A', '#D3', 3, { defenderTh: 14 }),
        hit(4, '#A', '#D4', 3, { defenderTh: null }),
      ]),
    ]);
    const a = s.accounts[0];
    expect(a.overall).toEqual({ attacks: 4, triples: 3, rate: 0.75 });
    expect(a.equal).toEqual({ attacks: 1, triples: 1, rate: 1 });
    expect(a.up).toEqual({ attacks: 1, triples: 0, rate: 0 });
    expect(a.down).toEqual({ attacks: 1, triples: 1, rate: 1 });
  });

  it('labels each war separately — a base tag reused across wars starts fresh', () => {
    const s = summarizeWars([war('w1', [hit(1, '#A', '#D1', 3)]), war('w2', [hit(1, '#A', '#D1', 3)])]);
    expect(s.accounts[0]).toMatchObject({ wars: 2, dead: 0, overall: { attacks: 2, triples: 2, rate: 1 } });
  });

  it('keys per account, not per person', () => {
    const s = summarizeWars([
      war('w1', [
        hit(1, '#MAIN', '#D1', 3, { attackerPersonId: 'p1' }),
        hit(2, '#ALT', '#D2', 0, { attackerPersonId: 'p1', attackerTh: 12, defenderTh: 12 }),
      ]),
    ]);
    expect(s.accounts.map((a) => [a.tag, a.overall.rate])).toEqual([['#MAIN', 1], ['#ALT', 0]]);
  });

  it('takes name and TH from the latest war', () => {
    const s = summarizeWars([
      war('w1', [hit(1, '#A', '#D1', 3, { attackerName: 'Old', attackerTh: 15, defenderTh: 15 })]),
      war('w2', [hit(1, '#A', '#D1', 3, { attackerName: 'New', attackerTh: 16 })]),
    ]);
    expect(s.accounts[0]).toMatchObject({ name: 'New', th: 16 });
  });

  it('averages destruction over counted attacks only', () => {
    const s = summarizeWars([
      war('w1', [hit(1, '#A', '#D1', 2, { destruction: 80 }), hit(2, '#A', '#D2', 3), hit(3, '#A', '#D2', 1, { destruction: 40 })]),
    ]);
    expect(s.accounts[0].avgDestruction).toBe(90);
  });

  it('reports equal-TH rate per town hall, highest first', () => {
    const s = summarizeWars([
      war('w1', [
        hit(1, '#A', '#D1', 3, { attackerTh: 15, defenderTh: 15 }),
        hit(2, '#B', '#D2', 3),
        hit(3, '#C', '#D3', 2),
      ]),
    ]);
    expect(s.equalByTh).toEqual([
      { th: 16, tally: { attacks: 2, triples: 1, rate: 0.5 } },
      { th: 15, tally: { attacks: 1, triples: 1, rate: 1 } },
    ]);
  });

  it('counts missed attacks from the lineup, including a member who never attacked', () => {
    const s = summarizeWars([
      war('w1', [hit(1, '#A', '#D1', 3)], [slot('#A', 1), slot('#B', 0)]),
      war('w2', [], [slot('#B', 0, { attacksAllowed: 1 })]),
    ]);
    const b = s.accounts.find((x) => x.tag === '#B')!;
    expect(b).toMatchObject({ missed: 3, wars: 2, totalAttacks: 0, overall: { attacks: 0, rate: null } });
    expect(s.accounts.find((x) => x.tag === '#A')!.missed).toBe(1);
    expect(s.clan.missed).toBe(4);
  });

  it('a summary of no wars is empty, with null rates', () => {
    const s = summarizeWars([]);
    expect(s).toMatchObject({ wars: 0, accounts: [], equalByTh: [] });
    expect(s.clan.overall.rate).toBeNull();
  });
});

describe('topHitters', () => {
  // Each account gets `triples` 3-stars and `misses` 2-stars, all equal TH, on distinct bases.
  function accountWith(tag: string, triples: number, misses: number): StatsAttack[] {
    let n = 0;
    const mk = (stars: number) => hit(n++, tag, `${tag}-D${n}`, stars);
    return [...Array.from({ length: triples }, () => mk(3)), ...Array.from({ length: misses }, () => mk(2))];
  }

  it('ranks by rate, requiring a minimum of counted attacks', () => {
    const s = summarizeWars([
      war('w1', [...accountWith('#A', 4, 1), ...accountWith('#B', 5, 0), ...accountWith('#LUCKY', 1, 0)]),
    ]);
    expect(topHitters(s.accounts).map((a) => a.tag)).toEqual(['#B', '#A']);
    expect(topHitters(s.accounts, { minAttacks: 1 }).map((a) => a.tag)).toEqual(['#B', '#LUCKY', '#A']);
  });

  it('breaks rate ties on triples, then tag', () => {
    const s = summarizeWars([
      war('w1', [...accountWith('#Z', 6, 0), ...accountWith('#Y', 5, 0), ...accountWith('#X', 5, 0)]),
    ]);
    expect(topHitters(s.accounts).map((a) => a.tag)).toEqual(['#Z', '#X', '#Y']);
  });

  it('honours the matchup and limit', () => {
    const s = summarizeWars([
      war('w1', [
        ...accountWith('#A', 5, 0),
        ...Array.from({ length: 5 }, (_, i) => hit(100 + i, '#B', `#UP${i}`, 3, { defenderTh: 17 })),
      ]),
    ]);
    expect(topHitters(s.accounts, { matchup: 'up' }).map((a) => a.tag)).toEqual(['#B']);
    expect(topHitters(s.accounts, { matchup: 'overall', limit: 1 })).toHaveLength(1);
  });
});

describe('isWarComplete', () => {
  it('needs as many attack rows as the lineup says were made', () => {
    expect(isWarComplete(war('w', [hit(1, '#A', '#D1', 3)], [slot('#A', 1), slot('#B', 0)]))).toBe(true);
    expect(isWarComplete(war('w', [hit(1, '#A', '#D1', 3)], [slot('#A', 2)]))).toBe(false);
  });

  it('trusts a war with no member rows', () => {
    expect(isWarComplete(war('w', []))).toBe(true);
  });
});
