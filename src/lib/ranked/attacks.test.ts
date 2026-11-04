import { describe, it, expect } from 'vitest';
import { rankedAttackRows } from './attacks';
import type { CoCBattle } from '@/lib/coc-api';

// Ranked weeks start Monday 05:00 UTC; Mon 2 Nov 2026 05:00 is one.
const NOW = new Date('2026-11-04T20:00:00Z');
const battle = (over: Partial<CoCBattle>): CoCBattle => ({
  battleType: 'ranked', attack: true, opponentPlayerTag: '#OPP', opponentName: 'opp', opponentTownHallLevel: 17,
  stars: 3, destructionPercentage: 100, battleTime: 115, battleTimestamp: '20261103T120000.000Z', ...over,
});
const account = { playerTag: '#A', thLevel: 16, leagueTierId: 105000031 };

describe('rankedAttackRows', () => {
  it('keeps only Ranked attacks and maps the battle onto a row', () => {
    const rows = rankedAttackRows(account, [
      battle({ armyShareCode: 'h0e8' }),
      battle({ attack: false, opponentPlayerTag: '#DEF' }), // a defence
      battle({ battleType: 'homeVillage', opponentPlayerTag: '#MP' }), // multiplayer
    ], NOW);
    expect(rows).toEqual([{
      player_tag: '#A', battle_at: '2026-11-03T12:00:00.000Z', opponent_tag: '#OPP', opponent_name: 'opp', opponent_th: 17,
      attacker_th: 16, attacker_league_tier_id: 105000031, stars: 3, destruction: 100, duration_seconds: 115, army_share_code: 'h0e8',
    }]);
  });

  it('records the league only for battles in the current Ranked week', () => {
    const [before, after] = rankedAttackRows(account, [
      battle({ battleTimestamp: '20261102T045900.000Z', opponentPlayerTag: '#OLD' }), // a minute before the reset
      battle({ battleTimestamp: '20261102T050100.000Z', opponentPlayerTag: '#NEW' }),
    ], NOW);
    expect(before).toMatchObject({ opponent_tag: '#OLD', attacker_league_tier_id: null });
    expect(after).toMatchObject({ opponent_tag: '#NEW', attacker_league_tier_id: 105000031 });
  });

  it('skips a battle without a readable timestamp', () => {
    expect(rankedAttackRows(account, [battle({ battleTimestamp: 'garbage' })], NOW)).toEqual([]);
  });
});
