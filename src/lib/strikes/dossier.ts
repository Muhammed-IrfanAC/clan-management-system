/**
 * PURE dossier + leadership-worklist derivation — no DB, no I/O, fully unit-testable.
 *
 * The strikes API returns a flat list of strikes (with their person / rule / violations / notes
 * embedded). Both the Player Dossier and the Leadership worklist are just two views over that same
 * list, derived deterministically from `deriveStrikeStatus`. This module groups the flat list by
 * person into dossiers, then buckets those dossiers into the leader's actionable worklist. `now` is
 * always injected so the whole thing stays pure (tests pass a fixed clock; callers pass new Date()).
 */

import type { Strike, StrikeViolation, StrikeNote } from '@/types/database';
import { deriveStrikeStatus, isActive, type StrikeStatus } from './status';

// Days-ahead window for the "expiring soon" worklist bucket — a strike about to drop off the active
// count is worth a leader's glance (a red may fall to orange, unlocking an Elder restoration).
export const EXPIRY_SOON_DAYS = 14;

/** A strike as returned by /api/strikes — the row plus the embeds the dossier renders. */
export type StrikeWithContext = Strike & {
  person?: { id: string; display_name: string } | null;
  rule?: { id: string; name: string } | null;
  player_account?: { in_game_name: string | null; player_tag?: string | null } | null;
  strike_violations?: StrikeViolation[];
  strike_notes?: StrikeNote[];
};

export type PersonDossier = {
  personId: string;
  displayName: string;
  strikes: StrikeWithContext[];       // all strikes, newest-issued first
  activeStrikes: StrikeWithContext[]; // the subset still inside the 90-day window
  status: StrikeStatus;               // derived colour/count/eligibility for the active set
};

/** True while the member has engaged with the strike (any trust-checklist box ticked). */
export function hasEngaged(s: Strike): boolean {
  return s.owned || s.apologised || s.understands_rule || s.promised;
}

function newestFirst(a: StrikeWithContext, b: StrikeWithContext): number {
  return new Date(b.issued_at).getTime() - new Date(a.issued_at).getTime();
}

/**
 * Group a flat strike list into one dossier per person, each carrying its derived status. Persons are
 * ordered by severity (most active strikes first, then by soonest next expiry) so the worst offenders
 * surface at the top of the dossier list.
 */
export function buildDossiers(strikes: StrikeWithContext[], now: Date): PersonDossier[] {
  const byPerson = new Map<string, StrikeWithContext[]>();
  for (const s of strikes) {
    const list = byPerson.get(s.person_id) ?? [];
    list.push(s);
    byPerson.set(s.person_id, list);
  }

  const dossiers: PersonDossier[] = [];
  for (const [personId, list] of byPerson) {
    const sorted = [...list].sort(newestFirst);
    const status = deriveStrikeStatus(
      sorted.map((s) => ({ issuedAt: s.issued_at, leadershipApproved: s.leadership_approved })),
      now,
    );
    dossiers.push({
      personId,
      displayName: sorted[0]?.person?.display_name || 'Unknown',
      strikes: sorted,
      activeStrikes: sorted.filter((s) => isActive(s.issued_at, now)),
      status,
    });
  }

  return dossiers.sort((a, b) => {
    if (b.status.activeCount !== a.status.activeCount) return b.status.activeCount - a.status.activeCount;
    const ae = a.status.nextExpiry ? new Date(a.status.nextExpiry).getTime() : Infinity;
    const be = b.status.nextExpiry ? new Date(b.status.nextExpiry).getTime() : Infinity;
    return ae - be;
  });
}

export type Worklist = {
  // Active, not-yet-trust-restored strikes: the member is currently war-ineligible / should be demoted.
  unresolved: PersonDossier[];
  // Has an active unresolved strike but has NOT engaged yet — awaiting the member's Discord response.
  awaitingResponse: PersonDossier[];
  // Member has engaged (owned/apologised/promised) but leadership hasn't signed off yet.
  awaitingApproval: PersonDossier[];
  // All active strikes now trust-restored but still on record -> re-promote to Elder in-game.
  eligibleForElderRestoration: PersonDossier[];
  // 3+ active strikes -> flagged for removal regardless of trust status.
  removalFlagged: PersonDossier[];
  // An active strike expiring within EXPIRY_SOON_DAYS — the count is about to drop.
  expiringSoon: PersonDossier[];
};

/**
 * Bucket dossiers into the leader worklist. A dossier can appear in more than one bucket (e.g. an
 * unresolved strike is both `unresolved` and either `awaitingResponse` or `awaitingApproval`); the UI
 * renders each bucket as its own actionable list.
 */
export function buildWorklist(dossiers: PersonDossier[], now: Date): Worklist {
  const soonCutoff = now.getTime() + EXPIRY_SOON_DAYS * 86_400_000;

  const unresolved = dossiers.filter((d) => d.status.activeCount > 0 && !d.status.warEligible);

  return {
    unresolved,
    awaitingResponse: unresolved.filter(
      (d) => !d.activeStrikes.some((s) => !s.leadership_approved && hasEngaged(s)),
    ),
    awaitingApproval: unresolved.filter(
      (d) => d.activeStrikes.some((s) => !s.leadership_approved && hasEngaged(s)),
    ),
    eligibleForElderRestoration: dossiers.filter((d) => d.status.eligibleForElderRestoration),
    removalFlagged: dossiers.filter((d) => d.status.removalFlagged),
    expiringSoon: dossiers.filter(
      (d) => d.status.nextExpiry != null && new Date(d.status.nextExpiry).getTime() <= soonCutoff,
    ),
  };
}
