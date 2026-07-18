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

/**
 * Fold a leader-CONFIRMED review suggestion (hit-up) into that war's strike. Same "one strike per
 * (person, war)" rule as the auto path: if a strike already exists for the war it appends the
 * violation (never a 2nd strike); otherwise it creates one with origin 'review'. Idempotent on the
 * suggestion's dedup_key. Returns the target strike id and whether it was newly created (so the
 * caller can notify only on a brand-new strike). Attributed to the confirming leader.
 */
export async function commitReviewStrike(params: {
  personId: string;
  playerTag: string | null;
  clanId: string | null;
  ruleId: string | null;
  ruleName?: string | null;
  warSource: string; // 'regular' | 'cwl'
  warRoundId: string | null;
  warLabel: string | null;
  description: string;
  dedupKey: string;
  occurredAt: string | null;
  memberName?: string | null;
  actorTag: string;
}): Promise<{ strikeId: string | null; created: boolean }> {
  const {
    personId, playerTag, clanId, ruleId, ruleName, warSource, warRoundId, warLabel,
    description, dedupKey, occurredAt, memberName, actorTag,
  } = params;

  // Stable per-(person, war) key — mirrors plan.strikeKeyFor. Null when the war round is unknown,
  // in which case the strike can't be folded and is created standalone.
  const strikeKey = warRoundId ? `${warSource}:${warRoundId}:${personId}` : null;

  const strikeRow = {
    person_id: personId,
    player_account_tag: playerTag,
    clan_id: clanId,
    rule_id: ruleId,
    war_source: warSource,
    war_round_id: warRoundId,
    war_label: warLabel,
    strike_key: strikeKey,
    origin: 'review',
    issued_at: occurredAt || new Date().toISOString(),
    logged_by: actorTag,
  };

  // Create-or-find the strike container. With a key we upsert (ignoreDuplicates => a returned row
  // means brand-new); without a key we plain-insert a standalone strike.
  let strikeId: string | null = null;
  let created = false;
  if (strikeKey) {
    const { data: ins, error } = await supabase
      .from('strikes')
      .upsert([strikeRow], { onConflict: 'strike_key', ignoreDuplicates: true })
      .select('id');
    if (error) { console.error('Review strike upsert failed:', error); return { strikeId: null, created: false }; }
    if (ins && ins.length) {
      strikeId = (ins[0] as { id: string }).id;
      created = true;
    } else {
      const { data: existing } = await supabase
        .from('strikes').select('id').eq('strike_key', strikeKey).maybeSingle();
      strikeId = (existing as { id: string } | null)?.id ?? null;
    }
  } else {
    const { data: ins, error } = await supabase.from('strikes').insert([strikeRow]).select('id').single();
    if (error) { console.error('Review strike insert failed:', error); return { strikeId: null, created: false }; }
    strikeId = (ins as { id: string }).id;
    created = true;
  }
  if (!strikeId) return { strikeId: null, created: false };

  // Append the violation (idempotent on dedup_key).
  const { error: vErr } = await supabase
    .from('strike_violations')
    .upsert(
      [{
        strike_id: strikeId,
        rule_id: ruleId,
        description,
        evidence: {},
        dedup_key: dedupKey,
        occurred_at: occurredAt,
        source: 'review',
      }],
      { onConflict: 'dedup_key', ignoreDuplicates: true },
    );
  if (vErr) console.error('Review strike-violation insert failed:', vErr);

  // Notify only when this confirmation created a brand-new strike (best-effort).
  if (created) {
    try {
      await notifyStrikeLogged({
        memberName: memberName ?? null,
        playerTag: playerTag ?? '—',
        ruleName: ruleName ?? null,
        warLabel,
        reasons: [description],
        webhookUrl: await webhookUrlForClan(clanId),
        mentionDiscordId: await discordUserIdForPerson(personId),
      });
    } catch (err) {
      console.error('Review strike Discord notify failed (non-fatal):', err);
    }
  }

  return { strikeId, created };
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
