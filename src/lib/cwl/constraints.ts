import type { CWLConstraints, CWLConstraintRule } from '@/types/database';
import { majorFloorTier } from './leagues';

/**
 * Reading a season's FROZEN constraint snapshot.
 *
 * A season's `constraints` JSONB is written once and never migrated (see migration 026): the whole
 * point of freezing it is that a completed roster stays explainable in the terms it was decided in.
 * That means the engine has to read two shapes:
 *
 *   pre-026:  { minThLevel, minLeague: 'dragon', maxBench }   — major tier only, "Dragon and up"
 *   post-026: { minThLevel, minLeagueTier: 29,   maxBench }   — exact sub-division, "Dragon 29+"
 *
 * `readRule` folds the legacy form into the new one by taking the major tier's LOWEST sub-division,
 * which is precisely what "Dragon+" meant when it was written — so an old season re-read today
 * produces the identical eligibility set, not a stricter one.
 *
 * Pure/data-only: safe to import from the allocation engine and from client components alike.
 */

/** A constraint rule with the legacy league form resolved away — what the engine consumes. */
export interface ResolvedRule {
  minThLevel: number | null;
  minLeagueTier: number | null;
  maxBench: number | null;
}

/** Normalize one (possibly legacy) rule into its resolved form. */
export function readRule(rule: CWLConstraintRule | undefined | null): ResolvedRule {
  if (!rule) return { minThLevel: null, minLeagueTier: null, maxBench: null };
  const minLeagueTier =
    rule.minLeagueTier ?? (rule.minLeague ? majorFloorTier(rule.minLeague) : null);
  return {
    minThLevel: rule.minThLevel ?? null,
    minLeagueTier,
    maxBench: rule.maxBench ?? null,
  };
}

/**
 * The resolved rule for a clan: its per-clan override layered FIELD BY FIELD over the season default.
 *
 * Per-field, not per-rule. The override form offers three inputs and labels each blank one
 * "(inherit)", so an override that only names a bench limit is a statement about the bench and
 * nothing else. Swapping the whole rule instead — which is what this used to do — silently dropped
 * that clan's inherited TH/league gates AND its inherited bench limit, so a season default of
 * "bench 2" quietly became the engine's built-in 5 for every clan carrying any override at all.
 * A null field means "not specified here", which is exactly what inherit means.
 */
export function readAllocationRule(constraints: CWLConstraints, clanId: string): ResolvedRule {
  const base = readRule(constraints.default);
  const override = constraints.perClan?.[clanId];
  if (!override) return base;
  const own = readRule(override);
  return {
    minThLevel: own.minThLevel ?? base.minThLevel,
    minLeagueTier: own.minLeagueTier ?? base.minLeagueTier,
    maxBench: own.maxBench ?? base.maxBench,
  };
}
