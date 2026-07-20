import type { DetectedViolation } from '../types';
import { findHitUps } from '../warContext';
import { loadWarContexts, loadExemptPersonIds, lookbackSince } from './warContextLoad';

/**
 * `war_unjustified_hitup` detector — DB wrapper around the pure findHitUps(). Review-mode: the
 * scanner queues these for a leader rather than auto-logging. Covers regular + CWL ended wars.
 * Leaders/co-leaders (by persons.access_role, alts included) are exempt.
 */
export async function detectUnjustifiedHitUps(
  config: Record<string, unknown>,
): Promise<DetectedViolation[]> {
  const contexts = await loadWarContexts(lookbackSince(config));
  const exemptPersonIds = await loadExemptPersonIds(
    contexts.flatMap((c) => c.attacks.map((a) => a.attackerPersonId)),
  );
  const cfg = { min_th_gap: Number(config.min_th_gap ?? 1), exemptPersonIds };
  return contexts.flatMap((c) => findHitUps(c, cfg));
}
