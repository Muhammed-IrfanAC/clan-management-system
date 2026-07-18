import { describe, it, expect } from 'vitest';
import { buildStrikeStatusUpdate } from './mutations';

const ACTOR = '#LEADER';
const NOW = '2026-07-18T12:00:00.000Z';

describe('buildStrikeStatusUpdate', () => {
  it('maps the trust checklist to its columns', () => {
    const res = buildStrikeStatusUpdate(
      { owned: true, apologised: true, understandsRule: false, promised: true },
      ACTOR,
      NOW,
    );
    expect(res.updates).toEqual({
      owned: true,
      apologised: true,
      understands_rule: false,
      promised: true,
    });
  });

  it('approval stamps approver + restoration timestamps', () => {
    const res = buildStrikeStatusUpdate({ leadershipApproved: true }, ACTOR, NOW);
    expect(res.updates).toEqual({
      leadership_approved: true,
      approved_by: ACTOR,
      approved_at: NOW,
      elder_restored_at: NOW,
      war_eligible_at: NOW,
    });
  });

  it('un-approval wipes the approval trail (reopens as unresolved)', () => {
    const res = buildStrikeStatusUpdate({ leadershipApproved: false }, ACTOR, NOW);
    expect(res.updates).toEqual({
      leadership_approved: false,
      approved_by: null,
      approved_at: null,
      elder_restored_at: null,
      war_eligible_at: null,
    });
  });

  it('markRemoved defaults removal_at to now and accepts a rejoin date', () => {
    const res = buildStrikeStatusUpdate(
      { markRemoved: true, rejoinAt: '2026-10-01' },
      ACTOR,
      NOW,
    );
    expect(res.updates!.removal_at).toBe(NOW);
    expect(res.updates!.rejoin_at).toBe(new Date('2026-10-01').toISOString());
  });

  it('markRemoved honours an explicit removalAt', () => {
    const res = buildStrikeStatusUpdate(
      { markRemoved: true, removalAt: '2026-07-10T00:00:00.000Z' },
      ACTOR,
      NOW,
    );
    expect(res.updates!.removal_at).toBe('2026-07-10T00:00:00.000Z');
  });

  it('un-removing clears both removal columns', () => {
    const res = buildStrikeStatusUpdate({ markRemoved: false }, ACTOR, NOW);
    expect(res.updates).toEqual({ removal_at: null, rejoin_at: null });
  });

  it('rejects a malformed date', () => {
    expect(buildStrikeStatusUpdate({ markRemoved: true, rejoinAt: 'nope' }, ACTOR, NOW).error)
      .toMatch(/rejoinAt/i);
    expect(buildStrikeStatusUpdate({ markRemoved: true, removalAt: 'nope' }, ACTOR, NOW).error)
      .toMatch(/removalAt/i);
  });

  it('trims notes and stores empty as null', () => {
    expect(buildStrikeStatusUpdate({ notes: '  keep an eye  ' }, ACTOR, NOW).updates).toEqual({
      notes: 'keep an eye',
    });
    expect(buildStrikeStatusUpdate({ notes: '   ' }, ACTOR, NOW).updates).toEqual({ notes: null });
  });

  it('errors when nothing recognised is supplied', () => {
    expect(buildStrikeStatusUpdate({}, ACTOR, NOW).error).toMatch(/no recognised/i);
  });

  it('combines several actions in one patch', () => {
    const res = buildStrikeStatusUpdate(
      { owned: true, leadershipApproved: true, notes: 'done' },
      ACTOR,
      NOW,
    );
    expect(res.updates).toMatchObject({
      owned: true,
      leadership_approved: true,
      approved_by: ACTOR,
      notes: 'done',
    });
  });
});
