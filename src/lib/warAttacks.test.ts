import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));

import { persistWarAttacks } from './warAttacks';

const us = [
  { tag: '#A', name: 'A', townhallLevel: 17, mapPosition: 1, attacks: [{ attackerTag: '#A', defenderTag: '#E1', stars: 3, destructionPercentage: 100, order: 1 }] },
  { tag: '#B', name: 'B', townhallLevel: 16, mapPosition: 2, attacks: [{ attackerTag: '#B', defenderTag: '#E2', stars: 2, destructionPercentage: 80, order: 2 }] },
];
const them = [
  { tag: '#E1', name: 'E1', townhallLevel: 17, mapPosition: 1 },
  { tag: '#E2', name: 'E2', townhallLevel: 17, mapPosition: 2 },
];

describe('persistWarAttacks', () => {
  beforeEach(() => {
    h.db = new FakeDb({ primaryKeys: { war_attacks: 'id' }, defaults: { war_attacks: () => ({ id: crypto.randomUUID() }) } });
  });

  const persist = (leagueByTag: Map<string, number>, state = 'inWar') =>
    persistWarAttacks({
      table: 'war_attacks', roundId: 'r1', state, ourMembers: us, opponentMembers: them,
      personByTag: new Map(), rankByTag: new Map(), leagueByTag,
    });

  it('records each attacker’s league tier, null when it is not known', async () => {
    await persist(new Map([['#A', 105000033]]));
    const rows = h.db.rows('war_attacks');
    expect(rows.map((r) => [r.attacker_tag, r.attacker_th, r.defender_th, r.attacker_league_tier_id])).toEqual([
      ['#A', 17, 17, 105000033],
      ['#B', 16, 17, null],
    ]);
  });

  it('keeps the league of the first sighting when the same attacks are polled again', async () => {
    await persist(new Map([['#A', 105000033], ['#B', 105000031]]));
    await persist(new Map([['#A', 105000034], ['#B', 105000032]]), 'warEnded');
    const rows = h.db.rows('war_attacks');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.attacker_league_tier_id, r.first_seen_state])).toEqual([
      [105000033, 'inWar'],
      [105000031, 'inWar'],
    ]);
  });
});
