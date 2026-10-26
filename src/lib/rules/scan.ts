import { supabase } from '@/lib/supabase';
import { DETECTORS } from './detectors';
import { detectorMeta } from './registry';
import { filterViolationsByClanMode, normalizeMode } from './automationScope';
import { commitStrikes } from '@/lib/strikes/commit';
import { alertQueuedSuggestions, type QueuedSuggestion } from '@/lib/strikes/reviewAlert';
import type { RuleAutomationMode } from '@/types/database';
import type { DetectedViolation } from './types';

/**
 * Rule-violation scan — the detection half of the Strike Management System.
 *
 * Runs every enabled, detector-backed rule and turns its DetectedViolations into strikes. It is safe
 * to run repeatedly (the cron sync calls it every few minutes): strikes dedup per (person, war) on a
 * stable strike_key and violations dedup on dedup_key, so an already-struck war is never re-struck.
 *
 * 'auto' detectors strike directly (clear-cut breaks: missed attack, late snipe) — one strike per
 * war, multiple breaks folding into it. 'review' detectors are judgement calls (hit-up): their
 * detections are queued into strike_suggestions for a leader to confirm (-> folds into that war's
 * strike) or dismiss, and no strike is issued until confirmed.
 *
 * Runs from the machine-auth cron with no actor identity, so auto-strikes are attributed to the
 * SYSTEM sentinel rather than any player tag.
 */

type AutomatedRule = {
  id: string;
  name: string;
  automation_key: string;
  automation_config: Record<string, unknown> | null;
};

export async function scanRuleViolations(): Promise<{ detected: number; logged: number; queued: number }> {
  // Per-clan automation scope: a clan may opt its wars out of automation, or limit it to CWL. Load
  // once and apply to every detector's output so the choice is enforced uniformly across all rules.
  const [{ data: rules }, { data: clanRows }] = await Promise.all([
    supabase
      .from('rules')
      .select('id, name, automation_key, automation_config')
      .eq('automation_enabled', true)
      .not('automation_key', 'is', null),
    supabase.from('clans').select('id, rule_automation_mode'),
  ]);
  const modeByClan = new Map<string, RuleAutomationMode>(
    (clanRows as { id: string; rule_automation_mode: string | null }[] | null)?.map((c) => [
      c.id,
      normalizeMode(c.rule_automation_mode),
    ]) || [],
  );

  // Detection only reads, so every detector runs at once. Committing stays sequential, in rule
  // order: two rules can fold into the same (account, war) strike, and concurrent commits would race
  // on its strike_key.
  const runnable = ((rules as AutomatedRule[] | null) || []).flatMap((rule) => {
    const detector = DETECTORS[rule.automation_key];
    const meta = detectorMeta(rule.automation_key);
    if (!detector || !meta) return []; // enabled rule pointing at an unknown detector — skip safely
    return [{ rule, detector, meta }];
  });
  const detections = await Promise.all(
    runnable.map(async ({ rule, detector }) => {
      try {
        return await detector(rule.automation_config || {});
      } catch (err) {
        console.error(`Detector ${rule.automation_key} failed:`, err);
        return null;
      }
    }),
  );

  let detected = 0;
  let logged = 0;
  let queued = 0;

  for (const [i, { rule, meta }] of runnable.entries()) {
    if (!detections[i]) continue;
    // Drop violations from clans that have opted this war type out of automation.
    const violations = filterViolationsByClanMode(detections[i], modeByClan);
    detected += violations.length;
    if (!violations.length) continue;

    if (meta.mode === 'auto') {
      const res = await commitStrikes(rule, violations);
      logged += res.loggedViolations;
    } else {
      queued += await queueStrikeSuggestions(rule, violations);
    }
  }

  return { detected, logged, queued };
}

/**
 * Judgement ('review') detectors: enqueue into strike_suggestions for a leader. Idempotent on
 * dedup_key — a re-scan never re-queues an item, and a dismissed one (its key preserved) never
 * reappears. No strike is issued here; confirming one (Phase 2) folds it into that war's strike.
 */
async function queueStrikeSuggestions(
  rule: AutomatedRule,
  violations: DetectedViolation[],
): Promise<number> {
  const rows = violations.map((v) => ({
    rule_id: rule.id,
    person_id: v.personId,
    player_account_tag: v.playerTag,
    clan_id: v.clanId,
    member_name: v.memberName,
    war_source: v.source,
    war_round_id: v.warRoundId,
    war_label: v.warLabel,
    description: v.description,
    dedup_key: v.dedupKey,
    evidence: v.evidence ?? {},
    occurred_at: v.occurredAt,
    status: 'pending',
  }));

  const { data: inserted, error } = await supabase
    .from('strike_suggestions')
    .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
    .select('id, clan_id, member_name, player_account_tag, war_label, description, occurred_at');
  if (error) {
    console.error('Strike-suggestion insert failed:', error);
    return 0;
  }
  const queued = (inserted as QueuedSuggestion[] | null) || [];
  // Only the rows this scan inserted come back, so each suggestion reaches Discord exactly once.
  try {
    await alertQueuedSuggestions(rule.name, queued);
  } catch (err) {
    console.error('Strike-suggestion Discord alert failed (non-fatal):', err);
  }
  return queued.length;
}
