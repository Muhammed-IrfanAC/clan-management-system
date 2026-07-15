import type { DetectedViolation } from '../types';
import { findHitUps } from '../warContext';
import { loadWarContexts, lookbackSince } from './warContextLoad';

/**
 * `war_unjustified_hitup` detector — DB wrapper around the pure findHitUps(). Review-mode: the
 * scanner queues these for a leader rather than auto-logging. Covers regular + CWL ended wars.
 */
export async function detectUnjustifiedHitUps(
  config: Record<string, unknown>,
): Promise<DetectedViolation[]> {
  const contexts = await loadWarContexts(lookbackSince(config));
  const cfg = { min_th_gap: Number(config.min_th_gap ?? 1) };
  return contexts.flatMap((c) => findHitUps(c, cfg));
}
