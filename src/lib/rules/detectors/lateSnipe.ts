import type { DetectedViolation } from '../types';
import { findLateSnipes } from '../warContext';
import { loadWarContexts, lookbackSince } from './warContextLoad';

/**
 * `war_late_snipe` detector — DB wrapper around the pure findLateSnipes(). Review-mode: queued for a
 * leader. Covers regular + CWL ended wars. Timing is inferred from each attack's first-seen poll.
 */
export async function detectLateSnipes(
  config: Record<string, unknown>,
): Promise<DetectedViolation[]> {
  const contexts = await loadWarContexts(lookbackSince(config));
  const cfg = {
    window_hours: Number(config.window_hours ?? 6),
    ranks: Array.isArray(config.ranks) ? (config.ranks as string[]) : undefined,
  };
  return contexts.flatMap((c) => findLateSnipes(c, cfg));
}
