import { describe, it, expect } from 'vitest';
import {
  deriveStrikeStatus,
  isActive,
  isWarEligible,
  expiryOf,
  STRIKE_WINDOW_DAYS,
  type StrikeLite,
} from './status';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const DAY_MS = 86_400_000;

/** A strike issued `days` ago (positive = in the past). */
function issuedDaysAgo(days: number, leadershipApproved = false): StrikeLite {
  return { issuedAt: new Date(NOW.getTime() - days * DAY_MS).toISOString(), leadershipApproved };
}

describe('isActive', () => {
  it('counts a strike inside the 90-day window', () => {
    expect(isActive(issuedDaysAgo(89).issuedAt, NOW)).toBe(true);
  });
  it('drops a strike past the window (only expiry removes it)', () => {
    expect(isActive(issuedDaysAgo(91).issuedAt, NOW)).toBe(false);
  });
  it('treats exactly-90-days-old as expired (strict >)', () => {
    expect(isActive(issuedDaysAgo(90).issuedAt, NOW)).toBe(false);
  });
});

describe('expiryOf', () => {
  it('is issue date + 90 days', () => {
    expect(expiryOf('2026-01-01T00:00:00.000Z')).toBe(
      new Date(new Date('2026-01-01T00:00:00.000Z').getTime() + STRIKE_WINDOW_DAYS * DAY_MS).toISOString(),
    );
  });
});

describe('deriveStrikeStatus — colour levels', () => {
  it('clear with no active strikes', () => {
    const s = deriveStrikeStatus([issuedDaysAgo(120)], NOW);
    expect(s.activeCount).toBe(0);
    expect(s.level).toBe('clear');
    expect(s.removalFlagged).toBe(false);
    expect(s.nextExpiry).toBeNull();
  });
  it('green at 1, orange at 2, red at 3', () => {
    expect(deriveStrikeStatus([issuedDaysAgo(1)], NOW).level).toBe('green');
    expect(deriveStrikeStatus([issuedDaysAgo(1), issuedDaysAgo(2)], NOW).level).toBe('orange');
    expect(deriveStrikeStatus([issuedDaysAgo(1), issuedDaysAgo(2), issuedDaysAgo(3)], NOW).level).toBe('red');
  });
  it('flags removal at 3 active — even if all are trust-restored', () => {
    const s = deriveStrikeStatus(
      [issuedDaysAgo(1, true), issuedDaysAgo(2, true), issuedDaysAgo(3, true)],
      NOW,
    );
    expect(s.activeCount).toBe(3);
    expect(s.removalFlagged).toBe(true); // acknowledging can't dodge the third strike
  });
  it('ignores expired strikes in the count', () => {
    const s = deriveStrikeStatus([issuedDaysAgo(1), issuedDaysAgo(100), issuedDaysAgo(200)], NOW);
    expect(s.activeCount).toBe(1);
    expect(s.level).toBe('green');
  });
});

describe('deriveStrikeStatus — war eligibility & demotion intent', () => {
  it('an active unresolved strike makes the player war-ineligible and should-be-Member', () => {
    const s = deriveStrikeStatus([issuedDaysAgo(1, false)], NOW);
    expect(s.warEligible).toBe(false);
    expect(s.shouldBeMember).toBe(true);
    expect(s.eligibleForElderRestoration).toBe(false);
  });
  it('once every active strike is trust-restored, eligibility returns and Elder restoration is due', () => {
    const s = deriveStrikeStatus([issuedDaysAgo(1, true), issuedDaysAgo(2, true)], NOW);
    expect(s.warEligible).toBe(true);
    expect(s.shouldBeMember).toBe(false);
    expect(s.eligibleForElderRestoration).toBe(true); // still 2 active, but resolved
  });
  it('a single unresolved strike among resolved ones keeps them ineligible', () => {
    const s = deriveStrikeStatus([issuedDaysAgo(1, true), issuedDaysAgo(2, false)], NOW);
    expect(s.warEligible).toBe(false);
    expect(s.eligibleForElderRestoration).toBe(false);
  });
  it('no strikes at all is eligible but not pending Elder restoration', () => {
    const s = deriveStrikeStatus([], NOW);
    expect(s.warEligible).toBe(true);
    expect(s.eligibleForElderRestoration).toBe(false);
  });
});

describe('deriveStrikeStatus — nextExpiry', () => {
  it('is the earliest active strike expiry', () => {
    const s = deriveStrikeStatus([issuedDaysAgo(10), issuedDaysAgo(50)], NOW);
    // earliest expiry = the oldest active strike (50 days ago) + 90 days
    expect(s.nextExpiry).toBe(expiryOf(issuedDaysAgo(50).issuedAt));
  });
});

describe('isWarEligible', () => {
  it('mirrors warEligible for allocation exclusion', () => {
    expect(isWarEligible([issuedDaysAgo(1, false)], NOW)).toBe(false);
    expect(isWarEligible([issuedDaysAgo(1, true)], NOW)).toBe(true);
    expect(isWarEligible([issuedDaysAgo(120, false)], NOW)).toBe(true); // expired => eligible
  });
});
