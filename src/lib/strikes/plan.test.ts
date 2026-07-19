import { describe, it, expect } from 'vitest';
import { planStrikes, strikeKeyFor } from './plan';
import type { DetectedViolation } from '@/lib/rules/types';

function violation(over: Partial<DetectedViolation>): DetectedViolation {
  return {
    personId: 'p1',
    playerTag: '#P1',
    clanId: 'clan1',
    source: 'regular',
    memberName: 'M',
    description: 'broke a rule',
    dedupKey: 'k1',
    occurredAt: '2026-07-15T12:00:00.000Z',
    warRoundId: 'round1',
    warLabel: 'Clan war vs X',
    ...over,
  };
}

describe('strikeKeyFor', () => {
  it('keys by source:round:account (player tag, not person)', () => {
    expect(strikeKeyFor(violation({}))).toBe('regular:round1:#P1');
  });
  it('is null without a war round', () => {
    expect(strikeKeyFor(violation({ warRoundId: null }))).toBeNull();
  });
});

describe('planStrikes', () => {
  it('folds multiple violations of the same account+war into ONE strike', () => {
    const plan = planStrikes([
      violation({ dedupKey: 'missed', description: 'missed attack' }),
      violation({ dedupKey: 'snipe', description: 'late snipe' }),
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0].strikeKey).toBe('regular:round1:#P1');
    expect(plan[0].violations.map((v) => v.dedupKey)).toEqual(['missed', 'snipe']);
  });

  it('separates different wars and different accounts', () => {
    const plan = planStrikes([
      violation({ playerTag: '#P1', warRoundId: 'r1', dedupKey: 'a' }),
      violation({ playerTag: '#P1', warRoundId: 'r2', dedupKey: 'b' }),
      violation({ playerTag: '#P2', warRoundId: 'r1', dedupKey: 'c' }),
    ]);
    expect(plan).toHaveLength(3);
    expect(new Set(plan.map((p) => p.strikeKey))).toEqual(
      new Set(['regular:r1:#P1', 'regular:r2:#P1', 'regular:r1:#P2']),
    );
  });

  it('separates two accounts of the SAME person in the same war (per-account, not per-person)', () => {
    const plan = planStrikes([
      violation({ personId: 'p1', playerTag: '#MAIN', warRoundId: 'r1', dedupKey: 'a' }),
      violation({ personId: 'p1', playerTag: '#ALT', warRoundId: 'r1', dedupKey: 'b' }),
    ]);
    expect(plan).toHaveLength(2);
    expect(new Set(plan.map((p) => p.strikeKey))).toEqual(
      new Set(['regular:r1:#MAIN', 'regular:r1:#ALT']),
    );
  });

  it('separates the same round id across war sources (regular vs cwl never collide)', () => {
    const plan = planStrikes([
      violation({ source: 'regular', warRoundId: 'r1', dedupKey: 'a' }),
      violation({ source: 'cwl', warRoundId: 'r1', dedupKey: 'b' }),
    ]);
    expect(plan).toHaveLength(2);
  });

  it('uses the earliest occurredAt as the strike issued_at', () => {
    const plan = planStrikes([
      violation({ dedupKey: 'later', occurredAt: '2026-07-15T18:00:00.000Z' }),
      violation({ dedupKey: 'earlier', occurredAt: '2026-07-15T06:00:00.000Z' }),
    ]);
    expect(plan[0].issuedAt).toBe('2026-07-15T06:00:00.000Z');
  });

  it('skips violations with no war round (cannot be deduped into a strike)', () => {
    const plan = planStrikes([violation({ warRoundId: null })]);
    expect(plan).toHaveLength(0);
  });

  it('keeps a war label even if the first violation of the group lacked one', () => {
    const plan = planStrikes([
      violation({ dedupKey: 'a', warLabel: null }),
      violation({ dedupKey: 'b', warLabel: 'Clan war vs X' }),
    ]);
    expect(plan[0].warLabel).toBe('Clan war vs X');
  });
});
