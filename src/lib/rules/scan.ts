import { supabase } from '@/lib/supabase';
import { DETECTORS } from './detectors';
import { detectorMeta } from './registry';
import { notifyWarningLogged, webhookUrlForClan, discordUserIdForPerson } from '@/lib/discord';
import { filterViolationsByClanMode, normalizeMode } from './automationScope';
import type { RuleAutomationMode } from '@/types/database';
import type { DetectedViolation } from './types';

/**
 * Rule-violation scan.
 *
 * Runs every enabled, detector-backed rule and turns its DetectedViolations into warnings. It is
 * safe to run repeatedly (the cron sync calls it every few minutes): each auto-warning carries a
 * stable `dedup_key` and is inserted with ON CONFLICT DO NOTHING, so an already-logged violation is
 * silently skipped and its member is never re-notified.
 *
 * 'auto' detectors log directly (clear-cut violations like a missed attack). 'review' detectors are
 * judgement calls (hit-up, late snipe): their detections are queued into warning_suggestions for a
 * leader to confirm (-> a real warning) or dismiss, and no member is notified until confirmed.
 *
 * Runs from the machine-auth cron with no actor identity, so auto-warnings are attributed to the
 * SYSTEM sentinel rather than any player tag.
 */

const SYSTEM_ACTOR = 'SYSTEM';

type AutomatedRule = {
  id: string;
  name: string;
  automation_key: string;
  automation_config: Record<string, unknown> | null;
};

export async function scanRuleViolations(): Promise<{ detected: number; logged: number; queued: number }> {
  const { data: rules } = await supabase
    .from('rules')
    .select('id, name, automation_key, automation_config')
    .eq('automation_enabled', true)
    .not('automation_key', 'is', null);

  // Per-clan automation scope: a clan may opt its wars out of automation, or limit it to CWL. Load
  // once and apply to every detector's output so the choice is enforced uniformly across all rules.
  const { data: clanRows } = await supabase.from('clans').select('id, rule_automation_mode');
  const modeByClan = new Map<string, RuleAutomationMode>(
    (clanRows as { id: string; rule_automation_mode: string | null }[] | null)?.map((c) => [
      c.id,
      normalizeMode(c.rule_automation_mode),
    ]) || [],
  );

  let detected = 0;
  let logged = 0;
  let queued = 0;

  for (const rule of (rules as AutomatedRule[] | null) || []) {
    const detector = DETECTORS[rule.automation_key];
    const meta = detectorMeta(rule.automation_key);
    if (!detector || !meta) continue; // enabled rule pointing at an unknown detector — skip safely

    let violations;
    try {
      violations = await detector(rule.automation_config || {});
    } catch (err) {
      console.error(`Detector ${rule.automation_key} failed:`, err);
      continue;
    }
    // Drop violations from clans that have opted this war type out of automation.
    violations = filterViolationsByClanMode(violations, modeByClan);
    detected += violations.length;
    if (!violations.length) continue;

    if (meta.mode === 'auto') {
      logged += await commitAuto(rule, violations);
    } else {
      queued += await queueForReview(rule, violations);
    }
  }

  return { detected, logged, queued };
}

/** Clear-cut ('auto') detectors: insert warnings idempotently and notify only the newly-logged ones. */
async function commitAuto(rule: AutomatedRule, violations: DetectedViolation[]): Promise<number> {
  const rows = violations.map((v) => ({
    person_id: v.personId,
    player_account_tag: v.playerTag,
    rule_id: rule.id,
    description: v.description,
    logged_by: SYSTEM_ACTOR,
    logged_at: v.occurredAt,
    acknowledged: false,
    source: 'auto',
    dedup_key: v.dedupKey,
  }));

  // Idempotent insert: dedup_key is UNIQUE and ignoreDuplicates => already-logged violations are
  // not re-inserted and not returned, so `inserted` is exactly the set of genuinely new warnings.
  const { data: inserted, error } = await supabase
    .from('warnings')
    .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
    .select('dedup_key');
  if (error) {
    console.error('Auto-warning insert failed:', error);
    return 0;
  }

  const newKeys = new Set((inserted as { dedup_key: string }[] | null)?.map((w) => w.dedup_key) || []);

  // Notify only for the newly-logged violations (best-effort; a failed send never blocks the scan).
  for (const v of violations) {
    if (!newKeys.has(v.dedupKey)) continue;
    try {
      await notifyWarningLogged({
        memberName: v.memberName,
        playerTag: v.playerTag,
        ruleName: rule.name,
        description: v.description,
        loggedBy: 'ClanOps (automated)',
        webhookUrl: await webhookUrlForClan(v.clanId),
        mentionDiscordId: await discordUserIdForPerson(v.personId),
      });
    } catch (err) {
      console.error('Auto-warning Discord notify failed (non-fatal):', err);
    }
  }
  return newKeys.size;
}

/**
 * Judgement ('review') detectors: enqueue into warning_suggestions for a leader. Idempotent on
 * dedup_key — a re-scan never re-queues an item, and a dismissed one (its key preserved) never
 * reappears. No member is notified here; that happens only if a leader confirms it.
 */
async function queueForReview(rule: AutomatedRule, violations: DetectedViolation[]): Promise<number> {
  const rows = violations.map((v) => ({
    rule_id: rule.id,
    person_id: v.personId,
    player_account_tag: v.playerTag,
    clan_id: v.clanId,
    member_name: v.memberName,
    description: v.description,
    dedup_key: v.dedupKey,
    evidence: v.evidence ?? {},
    occurred_at: v.occurredAt,
    status: 'pending',
  }));

  const { data: inserted, error } = await supabase
    .from('warning_suggestions')
    .upsert(rows, { onConflict: 'dedup_key', ignoreDuplicates: true })
    .select('dedup_key');
  if (error) {
    console.error('Review-suggestion insert failed:', error);
    return 0;
  }
  return (inserted as { dedup_key: string }[] | null)?.length || 0;
}
