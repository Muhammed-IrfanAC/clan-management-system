import { describe, it, expect } from 'vitest';
import {
  openBasesBefore,
  findHitUps,
  findLateSnipes,
  type WarContext,
  type WarAttackRec,
} from './warContext';

const END = '2026-07-15T12:00:00.000Z';
// Helper: an ISO string `hoursBeforeEnd` before END (for late-snipe timing).
function beforeEnd(hours: number): string {
  return new Date(new Date(END).getTime() - hours * 3600 * 1000).toISOString();
}

function attack(p: Partial<WarAttackRec> & { order: number }): WarAttackRec {
  return {
    attackerTag: `#A${p.order}`,
    attackerName: `Att${p.order}`,
    attackerPersonId: `person-${p.order}`,
    attackerTh: 14,
    attackerRank: 'member',
    defenderTag: '#D',
    defenderTh: 14,
    stars: 3,
    firstSeenAt: beforeEnd(20),
    firstSeenState: 'inWar',
    ...p,
  };
}

function ctx(over: Partial<WarContext>): WarContext {
  return {
    source: 'regular',
    roundId: 'r1',
    clanId: 'clan1',
    opponentName: 'Foes',
    endTime: END,
    lineup: [],
    attacks: [],
    ...over,
  };
}

describe('openBasesBefore', () => {
  const c = ctx({
    lineup: [
      { tag: '#b13', th: 13 },
      { tag: '#b14', th: 14 },
      { tag: '#b15', th: 15 },
    ],
    attacks: [
      attack({ order: 1, defenderTag: '#b13', stars: 3 }), // clears b13
      attack({ order: 2, defenderTag: '#b14', stars: 2 }), // b14 not cleared (2 stars)
    ],
  });

  it('excludes bases 3-starred before the given order', () => {
    const open = openBasesBefore(c, 5, 15).map((b) => b.tag);
    expect(open).toEqual(['#b14', '#b15']); // b13 cleared
  });

  it('respects the maxTh ceiling', () => {
    const open = openBasesBefore(c, 5, 14).map((b) => b.tag);
    expect(open).toEqual(['#b14']); // b15 too high, b13 cleared
  });

  it('only counts clears from strictly-earlier orders', () => {
    // At order 1, nothing earlier has cleared b13 yet.
    expect(openBasesBefore(c, 1, 15).map((b) => b.tag)).toContain('#b13');
  });
});

describe('findHitUps', () => {
  it('flags a hit-up when an equal/lower base is open', () => {
    const c = ctx({
      lineup: [
        { tag: '#easy', th: 13 },
        { tag: '#hard', th: 15 },
      ],
      attacks: [attack({ order: 1, attackerTh: 13, defenderTag: '#hard', defenderTh: 15, stars: 2 })],
    });
    const v = findHitUps(c);
    expect(v).toHaveLength(1);
    expect(v[0].dedupKey).toBe('war_unjustified_hitup:regular:r1:person-1');
    expect(v[0].evidence?.open_bases).toEqual([13]);
  });

  it('exempts a leadership person (by access_role), whatever the account rank', () => {
    const c = ctx({
      lineup: [{ tag: '#easy', th: 13 }, { tag: '#hard', th: 15 }],
      // The account attacked as a plain member, but its person is designated leadership.
      attacks: [attack({ order: 1, attackerPersonId: 'boss', attackerRank: 'member', attackerTh: 13, defenderTag: '#hard', defenderTh: 15, stars: 2 })],
    });
    expect(findHitUps(c, { exemptPersonIds: new Set(['boss']) })).toHaveLength(0);
    // Not exempt when the person isn't in the leadership set.
    expect(findHitUps(c)).toHaveLength(1);
  });

  it('flags a member once even when BOTH of their attacks hit up', () => {
    const c = ctx({
      lineup: [{ tag: '#easy', th: 13 }, { tag: '#h1', th: 15 }, { tag: '#h2', th: 15 }],
      attacks: [
        attack({ order: 1, attackerTag: '#same', attackerPersonId: 'p', attackerTh: 13, defenderTag: '#h1', defenderTh: 15, stars: 2 }),
        attack({ order: 2, attackerTag: '#same', attackerPersonId: 'p', attackerTh: 13, defenderTag: '#h2', defenderTh: 15, stars: 2 }),
      ],
    });
    const v = findHitUps(c);
    expect(v).toHaveLength(1); // one warning per member per war, not one per attack
    expect(v[0].dedupKey).toBe('war_unjustified_hitup:regular:r1:p');
  });

  it('does not flag when no equal/lower base is open', () => {
    const c = ctx({
      lineup: [{ tag: '#hard', th: 15 }],
      attacks: [attack({ order: 1, attackerTh: 13, defenderTag: '#hard', defenderTh: 15 })],
    });
    expect(findHitUps(c)).toHaveLength(0);
  });

  it('does not flag hitting an equal/lower base', () => {
    const c = ctx({
      lineup: [{ tag: '#mirror', th: 13 }, { tag: '#low', th: 12 }],
      attacks: [attack({ order: 1, attackerTh: 13, defenderTag: '#mirror', defenderTh: 13 })],
    });
    expect(findHitUps(c)).toHaveLength(0);
  });

  it('skips unlinked attackers (no person)', () => {
    const c = ctx({
      lineup: [{ tag: '#easy', th: 13 }],
      attacks: [attack({ order: 1, attackerPersonId: null, attackerTh: 13, defenderTag: '#hard', defenderTh: 15 })],
    });
    expect(findHitUps(c)).toHaveLength(0);
  });

  it('respects min_th_gap', () => {
    const c = ctx({
      lineup: [{ tag: '#easy', th: 13 }, { tag: '#plus1', th: 14 }],
      attacks: [attack({ order: 1, attackerTh: 13, defenderTag: '#plus1', defenderTh: 14, stars: 2 })],
    });
    expect(findHitUps(c, { min_th_gap: 2 })).toHaveLength(0); // +1 gap doesn't meet a +2 threshold
    expect(findHitUps(c, { min_th_gap: 1 })).toHaveLength(1);
  });
});

describe('findLateSnipes', () => {
  const lineup = [
    { tag: '#openLow', th: 13 },
    { tag: '#hit', th: 14 },
  ];

  it('flags a low-rank attack in the final window', () => {
    const c = ctx({
      lineup,
      attacks: [
        attack({ order: 1, attackerRank: 'elder', attackerTh: 14, defenderTag: '#hit', defenderTh: 14, stars: 2, firstSeenAt: beforeEnd(3) }),
      ],
    });
    const v = findLateSnipes(c, { window_hours: 6 });
    expect(v).toHaveLength(1);
    expect(v[0].dedupKey).toBe('war_late_snipe:regular:r1:1');
    expect(v[0].evidence?.rank).toBe('elder');
  });

  it('flags a late attack even when no equal/lower base is open (loot snipe on a cleared higher base)', () => {
    const c = ctx({
      lineup: [{ tag: '#hard', th: 15 }], // only a higher base exists
      attacks: [attack({ order: 1, attackerRank: 'member', attackerTh: 14, defenderTag: '#hard', defenderTh: 15, stars: 1, firstSeenAt: beforeEnd(2) })],
    });
    expect(findLateSnipes(c, { window_hours: 6 })).toHaveLength(1);
  });

  it('does not flag a leadership person (by access_role)', () => {
    const c = ctx({
      lineup,
      attacks: [attack({ order: 1, attackerPersonId: 'boss', attackerRank: 'member', attackerTh: 14, defenderTag: '#hit', stars: 2, firstSeenAt: beforeEnd(3) })],
    });
    expect(findLateSnipes(c, { exemptPersonIds: new Set(['boss']) })).toHaveLength(0);
  });

  it('does not flag attacks outside the final window', () => {
    const c = ctx({
      lineup,
      attacks: [attack({ order: 1, attackerRank: 'member', attackerTh: 14, defenderTag: '#hit', stars: 2, firstSeenAt: beforeEnd(10) })],
    });
    expect(findLateSnipes(c, { window_hours: 6 })).toHaveLength(0);
  });

  it('skips attacks whose timing is untrustworthy (first seen at warEnded)', () => {
    const c = ctx({
      lineup,
      attacks: [attack({ order: 1, attackerRank: 'member', attackerTh: 14, defenderTag: '#hit', stars: 2, firstSeenState: 'warEnded', firstSeenAt: beforeEnd(1) })],
    });
    expect(findLateSnipes(c)).toHaveLength(0);
  });

  it('flags any low-rank late attack regardless of what it hit', () => {
    const c = ctx({
      lineup: [{ tag: '#openLow', th: 13 }],
      attacks: [attack({ order: 1, attackerRank: 'member', attackerTh: 14, defenderTag: '#openLow', defenderTh: 13, stars: 3, firstSeenAt: beforeEnd(2) })],
    });
    expect(findLateSnipes(c)).toHaveLength(1);
  });

  it('flags a linked member when no one is exempt', () => {
    const c = ctx({
      lineup,
      attacks: [attack({ order: 1, attackerRank: 'co_leader', attackerTh: 14, defenderTag: '#hit', stars: 2, firstSeenAt: beforeEnd(3) })],
    });
    // Exemption is by person now, not by account rank: a co_leader-ranked account whose person has no
    // access_role is still flagged.
    expect(findLateSnipes(c)).toHaveLength(1);
  });
});
