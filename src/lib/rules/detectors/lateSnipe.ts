import type { DetectedViolation } from '../types';
import { findLateSnipes } from '../warContext';
import { loadLiveWarContexts, loadExemptPersonIds } from './warContextLoad';

/**
 * `war_late_snipe` detector — DB wrapper around the pure findLateSnipes(). Auto-mode. Covers live
 * regular + CWL wars, so the strike is recorded before war end once the final-window cutoff is
 * reached. Ended wars are intentionally excluded: this detector has already run while the war was
 * live, and repeating it after the war adds no new late-snipe strike. Timing is inferred from each
 * attack's first-seen poll. Leaders/co-leaders (by persons.access_role, alts included) are exempt.
 */
export async function detectLateSnipes(
  config: Record<string, unknown>,
): Promise<DetectedViolation[]> {
  const contexts = await loadLiveWarContexts();
  const exemptPersonIds = await loadExemptPersonIds(
    contexts.flatMap((c) => c.attacks.map((a) => a.attackerPersonId)),
  );
  const cfg = { window_hours: Number(config.window_hours ?? 6), exemptPersonIds };
  return contexts.flatMap((c) => findLateSnipes(c, cfg));
}
