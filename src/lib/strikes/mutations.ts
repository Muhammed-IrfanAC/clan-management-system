/**
 * Pure builder for a strike's leader-driven status update (trust restoration, leadership approval,
 * third-strike removal, notes). Kept free of I/O so the API route stays thin and the mapping/
 * validation is unit-tested.
 *
 * Design rule (per the strike model): NONE of these fields change a strike's active count — only the
 * 90-day expiry does. Leadership approval and the trust checklist record that the demotion/war-
 * eligibility INTENT has been cleared (a reference marker), they never remove the strike. Removal is
 * likewise a recorded intent; the in-game kick is manual.
 */

export interface StrikeStatusPatch {
  // Trust-restoration checklist (the four member steps a leader ticks off).
  owned?: boolean;
  apologised?: boolean;
  understandsRule?: boolean;
  promised?: boolean;
  // The fifth step: leadership confirmation. Clears (or reopens) demotion + war-eligibility intent.
  leadershipApproved?: boolean;
  // Third-strike removal bookkeeping (the actual kick is done in-game by a leader).
  markRemoved?: boolean;
  removalAt?: string | null;
  rejoinAt?: string | null;
  // Free-text leader notes on the strike itself.
  notes?: string | null;
}

export type BuildResult =
  | { updates: Record<string, unknown>; error?: undefined }
  | { error: string; updates?: undefined };

function validDateOrError(value: string): string | null {
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Translate a validated patch into the exact `strikes` column updates. `actorTag` attributes a
 * leadership approval; `nowIso` is the caller's clock (passed in so this stays deterministic/pure).
 * Returns `{ error }` when the body carries no recognised field or a date is malformed.
 */
export function buildStrikeStatusUpdate(
  patch: StrikeStatusPatch,
  actorTag: string,
  nowIso: string,
): BuildResult {
  const updates: Record<string, unknown> = {};

  if (typeof patch.owned === 'boolean') updates.owned = patch.owned;
  if (typeof patch.apologised === 'boolean') updates.apologised = patch.apologised;
  if (typeof patch.understandsRule === 'boolean') updates.understands_rule = patch.understandsRule;
  if (typeof patch.promised === 'boolean') updates.promised = patch.promised;

  if (typeof patch.leadershipApproved === 'boolean') {
    if (patch.leadershipApproved) {
      updates.leadership_approved = true;
      updates.approved_by = actorTag;
      updates.approved_at = nowIso;
      // Record the moment the app-side demotion/war-eligibility intent was cleared.
      updates.elder_restored_at = nowIso;
      updates.war_eligible_at = nowIso;
    } else {
      // Un-approve: reopen the strike as unresolved and wipe the approval trail.
      updates.leadership_approved = false;
      updates.approved_by = null;
      updates.approved_at = null;
      updates.elder_restored_at = null;
      updates.war_eligible_at = null;
    }
  }

  if (typeof patch.markRemoved === 'boolean') {
    if (patch.markRemoved) {
      let removalIso = nowIso;
      if (patch.removalAt) {
        const iso = validDateOrError(patch.removalAt);
        if (!iso) return { error: 'Invalid removalAt date' };
        removalIso = iso;
      }
      updates.removal_at = removalIso;
      if (patch.rejoinAt === null) {
        updates.rejoin_at = null;
      } else if (patch.rejoinAt !== undefined) {
        const iso = validDateOrError(patch.rejoinAt);
        if (!iso) return { error: 'Invalid rejoinAt date' };
        updates.rejoin_at = iso;
      }
    } else {
      updates.removal_at = null;
      updates.rejoin_at = null;
    }
  }

  if (patch.notes !== undefined) {
    const trimmed = String(patch.notes ?? '').trim();
    updates.notes = trimmed || null;
  }

  if (Object.keys(updates).length === 0) {
    return { error: 'No recognised fields to update' };
  }
  return { updates };
}
