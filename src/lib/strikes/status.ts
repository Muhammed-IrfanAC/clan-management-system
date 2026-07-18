/**
 * PURE strike-status derivation — no DB, no I/O, fully unit-testable.
 *
 * The whole strike model is "record events once, derive status automatically". A strike is ACTIVE
 * while its issue date is inside the rolling 90-day window; the active set alone drives everything:
 * the Green/Orange/Red colour, war eligibility, and removal-at-3. Nothing but the 90-day expiry ever
 * drops a strike from the active count — the trust-restoration checklist (leadership_approved) is a
 * leader reference marker that only clears the demotion / war-ineligibility INTENT, so a member who
 * keeps collecting strikes can't "acknowledge" their way out of a third-strike removal.
 */

export const STRIKE_WINDOW_DAYS = 90;
export const REMOVAL_THRESHOLD = 3;
const DAY_MS = 86_400_000;

/** The minimum a strike needs for status derivation. */
export type StrikeLite = {
  issuedAt: string;            // ISO — when the strike was issued (drives the 90-day expiry)
  leadershipApproved: boolean; // trust restored by leadership => intent cleared (but strike still counts)
};

export type StrikeLevel = 'clear' | 'green' | 'orange' | 'red';

/** Is this strike still inside the rolling window (i.e. counts toward the active total)? */
export function isActive(issuedAt: string, now: Date, windowDays = STRIKE_WINDOW_DAYS): boolean {
  const cutoff = now.getTime() - windowDays * DAY_MS;
  return new Date(issuedAt).getTime() > cutoff;
}

/** The expiry instant of a strike (issue date + window). */
export function expiryOf(issuedAt: string, windowDays = STRIKE_WINDOW_DAYS): string {
  return new Date(new Date(issuedAt).getTime() + windowDays * DAY_MS).toISOString();
}

export type StrikeStatus = {
  activeCount: number;         // active strikes in the window (0..n)
  level: StrikeLevel;          // clear=0, green=1, orange=2, red>=3
  removalFlagged: boolean;     // >= 3 active — flagged for removal regardless of trust status
  warEligible: boolean;        // true unless an active UNRESOLVED strike exists
  shouldBeMember: boolean;     // has an active unresolved strike -> intended demotion to Member
  nextExpiry: string | null;   // earliest active strike's expiry (the next time the count drops)
  eligibleForElderRestoration: boolean; // still has active strikes, but all are now resolved
};

/**
 * Derive a person's live strike status from their strike list. `now` is injected so this stays pure
 * and deterministic (tests pass a fixed clock; callers pass `new Date()`).
 */
export function deriveStrikeStatus(
  strikes: StrikeLite[],
  now: Date,
  windowDays = STRIKE_WINDOW_DAYS,
): StrikeStatus {
  const active = strikes.filter((s) => isActive(s.issuedAt, now, windowDays));
  const activeCount = active.length;
  const unresolvedCount = active.filter((s) => !s.leadershipApproved).length;

  const level: StrikeLevel =
    activeCount >= 3 ? 'red' : activeCount === 2 ? 'orange' : activeCount === 1 ? 'green' : 'clear';

  const nextExpiryMs = active.length
    ? Math.min(...active.map((s) => new Date(s.issuedAt).getTime() + windowDays * DAY_MS))
    : null;

  return {
    activeCount,
    level,
    removalFlagged: activeCount >= REMOVAL_THRESHOLD,
    warEligible: unresolvedCount === 0,
    shouldBeMember: unresolvedCount > 0,
    nextExpiry: nextExpiryMs === null ? null : new Date(nextExpiryMs).toISOString(),
    // Was demoted (has active strikes) but leadership has since restored trust on all of them — so
    // the member is ready to be re-promoted to Elder in-game. Surfaces on the leadership worklist.
    eligibleForElderRestoration: activeCount > 0 && unresolvedCount === 0,
  };
}

/**
 * A person is war-eligible unless they carry an active, not-yet-trust-restored strike. Used by the
 * CWL allocation engine (Phase 2) to auto-exclude struck members, and by the war-eligibility badge.
 */
export function isWarEligible(strikes: StrikeLite[], now: Date, windowDays = STRIKE_WINDOW_DAYS): boolean {
  return deriveStrikeStatus(strikes, now, windowDays).warEligible;
}
