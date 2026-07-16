import type { RuleAutomationMode } from '@/types/database';
import type { DetectedViolation } from './types';

/**
 * PURE per-clan automation-scope logic (no DB, no I/O — unit-tested).
 *
 * Each clan chooses how much of the rule automation applies to its members' wars:
 *   - `always`   — automate for both regular clan wars and CWL (default).
 *   - `cwl_only` — automate only for CWL wars.
 *   - `never`    — never automate.
 *
 * The scanner (scan.ts) loads every clan's mode and calls `filterViolationsByClanMode` on each
 * detector's output, so a clan's opt-out applies uniformly to every rule (missed attack, hit-up,
 * late snipe) without each detector needing to know about it.
 */

export const DEFAULT_RULE_AUTOMATION_MODE: RuleAutomationMode = 'always';

/** Coerce a raw/unknown DB value to a valid mode, defaulting to `always`. */
export function normalizeMode(mode: string | null | undefined): RuleAutomationMode {
  return mode === 'cwl_only' || mode === 'never' ? mode : DEFAULT_RULE_AUTOMATION_MODE;
}

/** Whether a violation from `source` should be automated under the clan's mode. */
export function clanAutomatesSource(mode: RuleAutomationMode, source: 'regular' | 'cwl'): boolean {
  switch (mode) {
    case 'never':
      return false;
    case 'cwl_only':
      return source === 'cwl';
    case 'always':
    default:
      return true;
  }
}

/**
 * Keep only the violations a clan opts into automating. A violation whose clan is unknown (null clan,
 * or a clan missing from the map) falls back to the default `always` — we never silently drop a
 * detection just because the clan row couldn't be resolved.
 */
export function filterViolationsByClanMode(
  violations: DetectedViolation[],
  modeByClan: Map<string, RuleAutomationMode>,
): DetectedViolation[] {
  return violations.filter((v) => {
    const mode = (v.clanId && modeByClan.get(v.clanId)) || DEFAULT_RULE_AUTOMATION_MODE;
    return clanAutomatesSource(mode, v.source);
  });
}
