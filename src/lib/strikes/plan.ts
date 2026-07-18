/**
 * PURE strike planner — groups a detector's DetectedViolations into per-(person, war) strikes.
 *
 * The rule is "one strike per (player, single war)": a member who breaks two rules in the same war
 * (or snipes twice) gets ONE strike carrying multiple violations, not several strikes. This module
 * does the grouping deterministically; the DB layer (commit.ts) then upserts each planned strike on
 * its stable strike_key, so the guarantee also holds across detectors and across repeated scans.
 */

import type { DetectedViolation } from '@/lib/rules/types';

export type PlannedStrike = {
  strikeKey: string;          // `${warSource}:${warRoundId}:${personId}` — stable, unique per war
  personId: string;
  playerTag: string;
  clanId: string | null;
  warSource: 'regular' | 'cwl';
  warRoundId: string;
  warLabel: string | null;
  issuedAt: string;           // earliest violation's occurredAt (the war-end instant, deterministic)
  violations: DetectedViolation[];
};

/** Build the stable per-(person, war) strike key. Returns null when the violation isn't war-scoped. */
export function strikeKeyFor(v: DetectedViolation): string | null {
  if (!v.warRoundId) return null;
  return `${v.source}:${v.warRoundId}:${v.personId}`;
}

/**
 * Group violations into planned strikes. Violations without a war round (shouldn't happen for the
 * built-in detectors) are skipped — a strike needs a war identity to dedup on. Within a group the
 * earliest occurredAt becomes issued_at so the 90-day clock starts at war end, deterministically.
 */
export function planStrikes(violations: DetectedViolation[]): PlannedStrike[] {
  const byKey = new Map<string, PlannedStrike>();

  for (const v of violations) {
    const key = strikeKeyFor(v);
    if (!key || !v.warRoundId) continue;

    const existing = byKey.get(key);
    if (existing) {
      existing.violations.push(v);
      if (v.occurredAt < existing.issuedAt) existing.issuedAt = v.occurredAt;
      // Keep a label if this violation has one and the group didn't yet.
      if (!existing.warLabel && v.warLabel) existing.warLabel = v.warLabel;
      continue;
    }

    byKey.set(key, {
      strikeKey: key,
      personId: v.personId,
      playerTag: v.playerTag,
      clanId: v.clanId,
      warSource: v.source,
      warRoundId: v.warRoundId,
      warLabel: v.warLabel,
      issuedAt: v.occurredAt,
      violations: [v],
    });
  }

  return [...byKey.values()];
}
