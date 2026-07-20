import type { DetectedViolation } from '../types';
import { findLateSnipes } from '../warContext';
import { loadWarContexts, loadExemptPersonIds, lookbackSince } from './warContextLoad';

/**
 * `war_late_snipe` detector — DB wrapper around the pure findLateSnipes(). Auto-mode. Covers regular +
 * CWL ended wars. Timing is inferred from each attack's first-seen poll. Leaders/co-leaders (by
 * persons.access_role, alts included) are exempt.
 */
export async function detectLateSnipes(
  config: Record<string, unknown>,
): Promise<DetectedViolation[]> {
  const contexts = await loadWarContexts(lookbackSince(config));
  const exemptPersonIds = await loadExemptPersonIds(
    contexts.flatMap((c) => c.attacks.map((a) => a.attackerPersonId)),
  );
  const cfg = { window_hours: Number(config.window_hours ?? 6), exemptPersonIds };
  return contexts.flatMap((c) => findLateSnipes(c, cfg));
}
