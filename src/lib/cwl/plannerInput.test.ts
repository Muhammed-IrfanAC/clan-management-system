import { describe, it, expect } from 'vitest';
import { buildPlannerInput, enemyThByPosition, livePendingStars, plannerRoster, warMapSlots, type PlannerSource } from './plannerInput';
import { slotExpectedStars as expectedStars, UNRATED } from './attackModel';

const cwl = (attackerTh: number, defenderTh: number, leagueTier: number | null) => ({ attackerTh, defenderTh, leagueTier, cwl: true });

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
    // #B is a TH16 in Dragon 28 hitting its mirror, a TH17.
    expect(input.accounts.find((a) => a.playerTag === '#B')!.pendingExpected).toBeCloseTo(expectedStars(cwl(16, 17, 28)));
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
    expect(input.accounts.find((a) => a.playerTag === '#B')).toMatchObject({ banned: true, rating: null });
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

describe('buildPlannerInput — war preference and war order', () => {
  const NOW = Date.parse('2026-11-03T18:00:00Z');
  const fresh = '2026-11-03T17:50:00Z';

  it('keeps an in-game opt-out out of the next war only', () => {
    const input = buildPlannerInput(
      source({
        now: NOW,
        roster: [
          { playerTag: '#A', name: 'A', thLevel: 16, leagueTier: 32, warPreference: 'out', warPreferenceCheckedAt: fresh },
          { playerTag: '#B', name: 'B', thLevel: 16, leagueTier: 28, warPreference: 'in', warPreferenceCheckedAt: fresh },
        ],
        rounds: [{ id: 'r1', round_number: 1, state: 'warEnded', opponent_tag: '#X', opponent_lineup: [], team_size: 15 }],
      }),
    );
    expect(input.rounds[0].roundNumber).toBe(2);
    expect([...input.rounds[0].preferenceOut!]).toEqual(['#A']);
    expect(input.rounds.slice(1).every((r) => !r.preferenceOut)).toBe(true);
  });

  it('ignores an opt-out that stopped being refreshed, e.g. last season’s toggle', () => {
    const input = buildPlannerInput(
      source({
        now: NOW,
        roster: [{ playerTag: '#A', name: 'A', thLevel: 16, leagueTier: 32, warPreference: 'out', warPreferenceCheckedAt: '2026-10-09T12:00:00Z' }],
      }),
    );
    expect(input.rounds[0].preferenceOut!.size).toBe(0);
  });

  it('scores each account by where the game placed it in past lineups', () => {
    const input = buildPlannerInput(
      source({
        lineupHistory: [{ members: [{ tag: '#B', pos: 1 }, { tag: '#A', pos: 2 }] }],
      }),
    );
    expect(input.accounts.find((a) => a.playerTag === '#B')!.warOrder).toBe(1);
    expect(input.accounts.find((a) => a.playerTag === '#A')!.warOrder).toBe(-1);
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

  it('carries the left-the-family flag of a signed-up account', () => {
    const roster = plannerRoster({
      signup: [{ tag: '#L', name: 'Left', th: 16 }],
      accounts: new Map([['#L', { ...known('#L'), leftFamily: true }]]),
      planned: [],
      excluded: [],
    });
    expect(roster[0]).toMatchObject({ playerTag: '#L', leftFamily: true });
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
    expect(pending.get('live:#A')).toBeCloseTo(expectedStars(cwl(16, 17, 32))); // +1 against slot 1
    expect(pending.get('live:#G')).toBeCloseTo(expectedStars(cwl(16, 16, null))); // unknown league, same TH
  });

  it('finds the mirror base by war-map slot, not by the raw CWL map position', () => {
    // CWL positions count benched sign-ups, so a war's members read 3, 7, 12 — slots 1, 2, 3.
    const pending = livePendingStars({
      roster: [{ playerTag: '#A', name: 'A', thLevel: 16, leagueTier: 30 }],
      rounds: [{ id: 'live', round_number: 1, state: 'inWar', opponent_tag: '#X', team_size: 3,
        opponent_lineup: [{ tag: 'e1', th: 18, pos: 2 }, { tag: 'e2', th: 17, pos: 5 }, { tag: 'e3', th: 15, pos: 9 }] }],
      members: [
        { round_id: 'live', player_tag: '#TOP', attacks_used: 1, stars: 3, map_position: 3 },
        { round_id: 'live', player_tag: '#MID', attacks_used: 1, stars: 3, map_position: 7 },
        { round_id: 'live', player_tag: '#A', attacks_used: 0, stars: 0, map_position: 12 },
      ],
    });
    expect(pending.get('live:#A')).toBeCloseTo(expectedStars(cwl(16, 15, 30))); // slot 3 → their TH15, a hit down
  });

  it('uses the account’s rating', () => {
    const src = (mean: number) => livePendingStars({
      roster: [{ playerTag: '#A', name: 'A', thLevel: 16, leagueTier: 30, rating: { ...UNRATED, mean, variance: 0.05, attacks: 30 } }],
      rounds: [{ id: 'live', round_number: 1, state: 'inWar', opponent_tag: '#X', team_size: 1, opponent_lineup: [{ tag: 'e1', th: 16, pos: 1 }] }],
      members: [{ round_id: 'live', player_tag: '#A', attacks_used: 0, stars: 0, map_position: 1 }],
    }).get('live:#A')!;
    expect(src(0.5)).toBeGreaterThan(src(-0.5));
  });
});

describe('warMapSlots', () => {
  it('ranks map positions within each war', () => {
    const slots = warMapSlots([
      { round_id: 'r1', player_tag: '#B', attacks_used: 0, stars: 0, map_position: 40 },
      { round_id: 'r1', player_tag: '#A', attacks_used: 0, stars: 0, map_position: 2 },
      { round_id: 'r2', player_tag: '#A', attacks_used: 0, stars: 0, map_position: 5 },
      { round_id: 'r2', player_tag: '#C', attacks_used: 0, stars: 0, map_position: null },
    ]);
    expect([...slots]).toEqual([['r1:#A', 1], ['r1:#B', 2], ['r2:#A', 1]]);
  });
});
