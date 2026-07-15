import { supabase } from '@/lib/supabase';
import { DETECTORS } from './detectors';
import { detectorMeta } from './registry';
import { notifyWarningLogged, webhookUrlForClan } from '@/lib/discord';

/**
 * Rule-violation scan.
 *
 * Runs every enabled, detector-backed rule and turns its DetectedViolations into warnings. It is
 * safe to run repeatedly (the cron sync calls it every few minutes): each auto-warning carries a
 * stable `dedup_key` and is inserted with ON CONFLICT DO NOTHING, so an already-logged violation is
 * silently skipped and its member is never re-notified.
 *
 * 'auto' detectors log directly (clear-cut violations like a missed attack). 'review' detectors are
 * a future step — their output will be queued for a leader to confirm rather than logged outright —
 * so they are detected here but not yet committed.
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

export async function scanRuleViolations(): Promise<{ detected: number; logged: number }> {
  const { data: rules } = await supabase
    .from('rules')
    .select('id, name, automation_key, automation_config')
    .eq('automation_enabled', true)
    .not('automation_key', 'is', null);

  let detected = 0;
  let logged = 0;

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
    detected += violations.length;
    if (!violations.length) continue;

    // Review-mode detectors are not auto-committed yet (leader-verify queue is a later phase).
    if (meta.mode !== 'auto') continue;

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
      continue;
    }

    const newKeys = new Set((inserted as { dedup_key: string }[] | null)?.map((w) => w.dedup_key) || []);
    logged += newKeys.size;

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
        });
      } catch (err) {
        console.error('Auto-warning Discord notify failed (non-fatal):', err);
      }
    }
  }

  return { detected, logged };
}
