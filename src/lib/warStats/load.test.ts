/* eslint-disable @typescript-eslint/no-explicit-any -- seeded rows are plain JSON */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeDb } from '@/test/fakeSupabase';

const h = vi.hoisted(() => ({ db: null as unknown as FakeDb }));
vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return h.db;
  },
}));

import { loadClanWarWindow } from './load';

const CLAN = 'clan-1';
/** A war that ended `d` days into October, with one tripled attack by #A. */
function seedWar(source: 'regular' | 'cwl', id: string, d: number, extra: Record<string, any> = {}) {
  const t = source === 'regular'
    ? { rounds: 'war_rounds', attacks: 'war_attacks', members: 'war_members' }
    : { rounds: 'cwl_rounds', attacks: 'cwl_war_attacks', members: 'cwl_war_members' };
  h.db.seed(t.rounds, [{ id, clan_id: CLAN, state: 'warEnded', end_time: `2026-10-${String(d).padStart(2, '0')}T12:00:00Z`, ...extra }]);
  h.db.seed(t.attacks, [{
    round_id: id, attack_order: 1, attacker_tag: '#A', attacker_name: 'A', attacker_person_id: null,
    attacker_th: 16, defender_tag: '#D1', defender_th: 16, stars: 3, destruction: source === 'cwl' ? '100' : 100,
  }]);
  h.db.seed(t.members, [{ round_id: id, player_tag: '#A', name: 'A', person_id: null, th_level: 16, attacks_used: 1 }]);
}

beforeEach(() => {
  h.db = new FakeDb();
});

describe('loadClanWarWindow', () => {
  it('interleaves regular and CWL wars by end time, oldest first, capped at the window', async () => {
    seedWar('regular', 'r1', 1);
    seedWar('cwl', 'c1', 2);
    seedWar('regular', 'r2', 3);
    seedWar('cwl', 'c2', 4);
    const { wars } = await loadClanWarWindow(CLAN, 3);
    expect(wars.map((w) => w.id)).toEqual(['cwl:c1', 'regular:r2', 'cwl:c2']);
  });

  it('allows one attack per CWL member and the stored count in a regular war', async () => {
    seedWar('regular', 'r1', 1, { attacks_per_member: 2 });
    seedWar('cwl', 'c1', 2);
    const { wars } = await loadClanWarWindow(CLAN);
    expect(wars.map((w) => w.members![0].attacksAllowed)).toEqual([2, 1]);
    expect(wars[1].attacks[0].destruction).toBe(100); // CWL NUMERIC string coerced
  });

  it('ignores other clans, unfinished wars and undated wars', async () => {
    seedWar('regular', 'r1', 1);
    seedWar('regular', 'other', 2, { clan_id: 'clan-2' });
    seedWar('regular', 'live', 3, { state: 'inWar' });
    seedWar('cwl', 'undated', 4, { end_time: null });
    const { wars } = await loadClanWarWindow(CLAN);
    expect(wars.map((w) => w.id)).toEqual(['regular:r1']);
  });

  it('leaves out a war whose attacks were only partly stored', async () => {
    seedWar('regular', 'r1', 1);
    seedWar('regular', 'r2', 2);
    h.db.rows('war_members').find((m) => m.round_id === 'r2')!.attacks_used = 2;
    const { wars, skipped } = await loadClanWarWindow(CLAN);
    expect(wars.map((w) => w.id)).toEqual(['regular:r1']);
    expect(skipped).toBe(1);
  });

  it('surfaces a read error rather than reporting an empty window', async () => {
    seedWar('regular', 'r1', 1);
    h.db.failNext('war_attacks', 'select', 'boom');
    await expect(loadClanWarWindow(CLAN)).rejects.toMatchObject({ message: 'boom' });
  });
});
