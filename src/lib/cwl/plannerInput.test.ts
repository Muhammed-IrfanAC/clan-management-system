import { describe, it, expect } from 'vitest';
import { buildPlannerInput, enemyThByPosition, livePendingStars, plannerRoster, type PlannerSource } from './plannerInput';

function source(over: Partial<PlannerSource> = {}): PlannerSource {
  return {
    warSize: 15,
    roster: [
      { playerTag: '#A', name: 'A', thLevel: 16, leagueTier: 32 },
      { playerTag: '#B', name: 'B', thLevel: 16, leagueTier: 28 },
    ],
    rounds: [],
    members: [],
    overrides: [],
    flags: [],
    optedOut: new Set(),
    groupClans: [],
    ...over,
  };
}

describe('buildPlannerInput', () => {
  it('plans all seven rounds before anything is drawn', () => {
    const input = buildPlannerInput(source());
    expect(input.rounds.map((r) => r.roundNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(input.rounds.every((r) => r.enemyLineup === null)).toBe(true);
    expect(input.warSize).toBe(15);
  });

  it('settles rounds at battle day, sums their stars and keeps a prep-day round open with its enemy', () => {
    const input = buildPlannerInput(
      source({
        rounds: [
          { id: 'r1', round_number: 1, state: 'warEnded', opponent_tag: '#X', opponent_lineup: [], team_size: 30 },
          { id: 'r2', round_number: 2, state: 'preparation', opponent_tag: '#Y', opponent_lineup: [{ tag: 'e2', th: 15, pos: 2 }, { tag: 'e1', th: 17, pos: 1 }], team_size: 30 },
        ],
        members: [
          { round_id: 'r1', player_tag: '#A', attacks_used: 1, stars: 3, map_position: 1 },
          { round_id: 'r1', player_tag: '#B', attacks_used: 1, stars: 2, map_position: 2 },
          { round_id: 'r2', player_tag: '#A', attacks_used: 0, stars: 0, map_position: 1 },
        ],
      }),
    );
    expect(input.warSize).toBe(30);
    expect(input.rounds.map((r) => r.roundNumber)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(input.rounds[0].enemyLineup).toEqual([17, 15]);
    expect(input.accounts.find((a) => a.playerTag === '#A')).toMatchObject({ starsSoFar: 3, pendingExpected: 0 });
    expect(input.accounts.find((a) => a.playerTag === '#B')!.starsSoFar).toBe(2);
  });

  it('gives an account that has not attacked yet in a live war its expected stars as pending', () => {
    const input = buildPlannerInput(
      source({
        rounds: [{ id: 'r1', round_number: 1, state: 'inWar', opponent_tag: '#X', opponent_lineup: [{ tag: 'e', th: 17, pos: 1 }], team_size: 15 }],
        members: [{ round_id: 'r1', player_tag: '#B', attacks_used: 0, stars: 0, map_position: 1 }],
      }),
    );
    // #B is TH16 weak hitting a TH17: 50% triple → 1.8 + 0.6.
    expect(input.accounts.find((a) => a.playerTag === '#B')!.pendingExpected).toBeCloseTo(2.4);
  });

  it('carries flags, opt-outs and per-war overrides onto the right account and round', () => {
    const input = buildPlannerInput(
      source({
        flags: [{ player_account_tag: '#A', flag: 'rule_breaker' }, { player_account_tag: '#B', flag: 'banned' }],
        optedOut: new Set(['#A']),
        overrides: [{ round_number: 3, player_account_tag: '#B', mode: 'in' }, { round_number: 4, player_account_tag: '#A', mode: 'out' }],
      }),
    );
    expect(input.accounts.find((a) => a.playerTag === '#A')).toMatchObject({ ruleBreaker: true, banned: false, optedOut: true });
    expect(input.accounts.find((a) => a.playerTag === '#B')).toMatchObject({ banned: true });
    expect([...input.rounds[2].forceIn!]).toEqual(['#B']);
    expect([...input.rounds[3].forceOut!]).toEqual(['#A']);
    expect(input.rounds[0].forceIn!.size).toBe(0);
  });

  it('scores unrevealed rounds only against opponents not yet drawn', () => {
    const input = buildPlannerInput(
      source({
        rounds: [{ id: 'r1', round_number: 1, state: 'warEnded', opponent_tag: '#X', opponent_lineup: [], team_size: 15 }],
        groupClans: [
          { opponent_tag: '#X', members: [{ th: 18 }] },
          { opponent_tag: '#Y', members: [{ th: 14 }, { th: 15 }] },
        ],
      }),
    );
    expect(input.futureOpponents).toEqual([[14, 15]]);
  });
});

describe('enemyThByPosition', () => {
  it('orders by map position and treats an empty lineup as unknown', () => {
    expect(enemyThByPosition([{ tag: 'b', th: 14, pos: 2 }, { tag: 'a', th: 16, pos: 1 }])).toEqual([16, 14]);
    expect(enemyThByPosition([])).toBeNull();
    expect(enemyThByPosition(null)).toBeNull();
  });
});

describe('plannerRoster', () => {
  const known = (tag: string, over: Partial<{ name: string; personName: string | null; thLevel: number; leagueTier: number | null }> = {}) => ({
    playerTag: tag, name: tag, personName: 'P', thLevel: 16, leagueTier: 32, ...over,
  });

  it('takes the signup list once there is one, unlinked accounts included', () => {
    const roster = plannerRoster({
      signup: [{ tag: '#L', name: 'Linked', th: 16 }, { tag: '#U', name: 'Unlinked', th: 15 }, { tag: '#G', name: 'Ghost', th: 14 }],
      accounts: new Map([
        ['#L', known('#L', { name: 'Linked' })],
        ['#U', known('#U', { name: 'Unlinked', personName: null, thLevel: 15, leagueTier: 30 })],
      ]),
      planned: [known('#NOT_SIGNED')],
      excluded: [],
    });
    expect(roster.map((a) => a.playerTag)).toEqual(['#L', '#U', '#G']);
    expect(roster[1]).toMatchObject({ personName: null, leagueTier: 30 });
    // Never synced: TH from the signup, league unknown rather than unranked.
    expect(roster[2]).toMatchObject({ name: 'Ghost', thLevel: 14, leagueTier: null, untracked: true });
    expect(roster[0].untracked).toBeUndefined();
  });

  it('falls back to the planned allocation before signup', () => {
    const roster = plannerRoster({ signup: null, accounts: new Map(), planned: [known('#A')], excluded: [] });
    expect(roster.map((a) => a.playerTag)).toEqual(['#A']);
  });

  it('keeps banned or opted-out accounts listed without duplicating signed-up ones', () => {
    const roster = plannerRoster({
      signup: [{ tag: '#A', name: 'A', th: 16 }],
      accounts: new Map([['#A', known('#A')]]),
      planned: [],
      excluded: [known('#A'), known('#B')],
    });
    expect(roster.map((a) => a.playerTag)).toEqual(['#A', '#B']);
  });
});

describe('livePendingStars', () => {
  it('scores only un-attacked members of a war at battle day, against their mirror base', () => {
    const pending = livePendingStars({
      roster: [
        { playerTag: '#A', name: 'A', thLevel: 16, leagueTier: 32 },
        { playerTag: '#G', name: 'G', thLevel: 16, leagueTier: null, untracked: true },
      ],
      rounds: [
        { id: 'live', round_number: 2, state: 'inWar', opponent_tag: '#X', opponent_lineup: [{ tag: 'e1', th: 17, pos: 1 }, { tag: 'e2', th: 16, pos: 2 }], team_size: 15 },
        { id: 'prep', round_number: 3, state: 'preparation', opponent_tag: '#Y', opponent_lineup: [], team_size: 15 },
      ],
      members: [
        { round_id: 'live', player_tag: '#A', attacks_used: 0, stars: 0, map_position: 1 },
        { round_id: 'live', player_tag: '#G', attacks_used: 0, stars: 0, map_position: 2 },
        { round_id: 'live', player_tag: '#DONE', attacks_used: 1, stars: 3, map_position: 3 },
        { round_id: 'prep', player_tag: '#A', attacks_used: 0, stars: 0, map_position: 1 },
      ],
    });
    expect([...pending.keys()].sort()).toEqual(['live:#A', 'live:#G']);
    expect(pending.get('live:#A')).toBeCloseTo(1.8 + 1.2 * 0.95); // strong, +1
    expect(pending.get('live:#G')).toBeCloseTo(1.8 + 1.2 * 0.95); // unknown league → medium, same TH
  });
});
