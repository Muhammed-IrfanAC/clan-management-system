import { supabase } from '@/lib/supabase';
import { notifyStrikeLogged, webhookUrlForClan, discordUserIdForPerson } from '@/lib/discord';
import { planStrikes, type PlannedStrike } from './plan';
import type { DetectedViolation } from '@/lib/rules/types';

/**
 * DB writer for auto-strikes. Turns a detector's DetectedViolations into strikes + strike_violations,
 * enforcing "one strike per (person, war)" via the strike_key unique index and idempotency via the
 * violation dedup_key. Safe to re-run every scan: an already-struck war is not re-struck and an
 * already-logged violation is not re-appended. A brand-new strike notifies the member's clan channel;
 * a violation folded into an existing strike does not (the end-of-war summary — Phase 4 — covers it).
 */

const SYSTEM_ACTOR = 'SYSTEM';

type StrikeRule = { id: string; name: string };

export async function commitStrikes(
  rule: StrikeRule,
  violations: DetectedViolation[],
): Promise<{ newStrikes: number; loggedViolations: number }> {
  const planned = planStrikes(violations);
  if (!planned.length) return { newStrikes: 0, loggedViolations: 0 };

  // 1. Upsert the strike containers. ignoreDuplicates => `created` is exactly the brand-new strikes.
  const strikeRows = planned.map((p) => ({
    person_id: p.personId,
    player_account_tag: p.playerTag,
    clan_id: p.clanId,
    rule_id: rule.id,
    war_source: p.warSource,
    war_round_id: p.warRoundId,
    war_label: p.warLabel,
    strike_key: p.strikeKey,
    origin: 'auto',
    issued_at: p.issuedAt,
    logged_by: SYSTEM_ACTOR,
  }));

  const { data: created, error: strikeErr } = await supabase
    .from('strikes')
    .upsert(strikeRows, { onConflict: 'strike_key', ignoreDuplicates: true })
    .select('id, strike_key');
  if (strikeErr) {
    console.error('Strike insert failed:', strikeErr);
    return { newStrikes: 0, loggedViolations: 0 };
  }
  const newKeys = new Set((created as { strike_key: string }[] | null)?.map((s) => s.strike_key) || []);

  // 2. Resolve the strike id for EVERY planned key (new + pre-existing) to attach violations.
  const keys = planned.map((p) => p.strikeKey);
  const { data: allStrikes, error: selErr } = await supabase
    .from('strikes')
    .select('id, strike_key')
    .in('strike_key', keys);
  if (selErr) {
    console.error('Strike lookup failed:', selErr);
    return { newStrikes: newKeys.size, loggedViolations: 0 };
  }
  const idByKey = new Map((allStrikes as { id: string; strike_key: string }[]).map((s) => [s.strike_key, s.id]));

  // 3. Append the individual violations (idempotent on dedup_key).
  const violationRows = planned.flatMap((p) => {
    const strikeId = idByKey.get(p.strikeKey);
    if (!strikeId) return [];
    return p.violations.map((v) => ({
      strike_id: strikeId,
      rule_id: rule.id,
      description: v.description,
      evidence: v.evidence ?? {},
      dedup_key: v.dedupKey,
      occurred_at: v.occurredAt,
      source: 'auto',
    }));
  });

  let loggedViolations = 0;
  if (violationRows.length) {
    const { data: insertedV, error: vErr } = await supabase
      .from('strike_violations')
      .upsert(violationRows, { onConflict: 'dedup_key', ignoreDuplicates: true })
      .select('dedup_key');
    if (vErr) console.error('Strike-violation insert failed:', vErr);
    else loggedViolations = (insertedV as unknown[] | null)?.length || 0;
  }

  // 4. Notify only for brand-new strikes (best-effort; a failed send never blocks the scan).
  await notifyNewStrikes(rule, planned.filter((p) => newKeys.has(p.strikeKey)));

  return { newStrikes: newKeys.size, loggedViolations };
}

async function notifyNewStrikes(rule: StrikeRule, newStrikes: PlannedStrike[]): Promise<void> {
  for (const p of newStrikes) {
    try {
      await notifyStrikeLogged({
        memberName: p.violations[0]?.memberName ?? null,
        playerTag: p.playerTag,
        ruleName: rule.name,
        warLabel: p.warLabel,
        reasons: p.violations.map((v) => v.description),
        webhookUrl: await webhookUrlForClan(p.clanId),
        mentionDiscordId: await discordUserIdForPerson(p.personId),
      });
    } catch (err) {
      console.error('Strike Discord notify failed (non-fatal):', err);
    }
  }
}
