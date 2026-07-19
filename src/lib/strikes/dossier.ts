/**
 * PURE dossier + leadership-worklist derivation — no DB, no I/O, fully unit-testable.
 *
 * The strikes API returns a flat list of strikes (with their person / account / rule / violations /
 * notes embedded). Both the Account Dossier and the Leadership worklist are just two views over that
 * same list, derived deterministically from `deriveStrikeStatus`. Strikes are scoped to the ACCOUNT
 * (player tag): each of a person's alts is judged on its own strikes — so this module groups the flat
 * list by `player_account_tag` into dossiers, then buckets those dossiers into the leader's actionable
 * worklist. `now` is always injected so the whole thing stays pure (tests pass a fixed clock; callers
 * pass new Date()).
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

export type AccountDossier = {
  accountTag: string;                 // the player tag this dossier is scoped to (grouping key)
  inGameName: string;                 // the account's in-game name (card title)
  personId: string;                   // the person the account belongs to (links to their profile)
  displayName: string;                // the person's display name (card subtitle — the human)
  strikes: StrikeWithContext[];       // all strikes on this account, newest-issued first
  activeStrikes: StrikeWithContext[]; // the subset still inside the 90-day window
  status: StrikeStatus;               // derived colour/count/eligibility for the active set
};

function newestFirst(a: StrikeWithContext, b: StrikeWithContext): number {
  return new Date(b.issued_at).getTime() - new Date(a.issued_at).getTime();
}

/**
 * Group a flat strike list into one dossier per ACCOUNT (player tag), each carrying its derived
 * status. Accounts are ordered by severity (most active strikes first, then by soonest next expiry)
 * so the worst offenders surface at the top of the dossier list. Strikes with no account tag fall
 * back to their person id as the grouping key (legacy rows only).
 */
export function buildDossiers(strikes: StrikeWithContext[], now: Date): AccountDossier[] {
  const byAccount = new Map<string, StrikeWithContext[]>();
  for (const s of strikes) {
    const key = s.player_account_tag ?? s.person_id;
    const list = byAccount.get(key) ?? [];
    list.push(s);
    byAccount.set(key, list);
  }

  const dossiers: AccountDossier[] = [];
  for (const [key, list] of byAccount) {
    const sorted = [...list].sort(newestFirst);
    const status = deriveStrikeStatus(
      sorted.map((s) => ({ issuedAt: s.issued_at, leadershipApproved: s.leadership_approved })),
      now,
    );
    const head = sorted[0];
    dossiers.push({
      accountTag: head?.player_account_tag ?? key,
      inGameName: head?.player_account?.in_game_name || head?.player_account_tag || 'Unknown account',
      personId: head?.person_id ?? '',
      displayName: head?.person?.display_name || 'Unknown',
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
  // Active, not-yet-approved strikes: the account is currently war-ineligible / should be demoted.
  // Cleared by a single leader approval (trust restoration), which lifts the demotion/eligibility intent.
  unresolved: AccountDossier[];
  // All active strikes now approved but still on record -> re-promote to Elder in-game.
  eligibleForElderRestoration: AccountDossier[];
  // 3+ active strikes -> flagged for removal regardless of approval status.
  removalFlagged: AccountDossier[];
  // An active strike expiring within EXPIRY_SOON_DAYS — the count is about to drop.
  expiringSoon: AccountDossier[];
};

/**
 * Bucket dossiers into the leader worklist. A dossier can appear in more than one bucket; the UI
 * renders each bucket as its own actionable, click-to-filter list.
 */
export function buildWorklist(dossiers: AccountDossier[], now: Date): Worklist {
  const soonCutoff = now.getTime() + EXPIRY_SOON_DAYS * 86_400_000;

  return {
    unresolved: dossiers.filter((d) => d.status.activeCount > 0 && !d.status.warEligible),
    eligibleForElderRestoration: dossiers.filter((d) => d.status.eligibleForElderRestoration),
    removalFlagged: dossiers.filter((d) => d.status.removalFlagged),
    expiringSoon: dossiers.filter(
      (d) => d.status.nextExpiry != null && new Date(d.status.nextExpiry).getTime() <= soonCutoff,
    ),
  };
}
