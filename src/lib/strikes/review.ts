import { supabase } from '@/lib/supabase';
import { commitReviewStrike } from './commit';

/**
 * Act on a queued strike suggestion (hit-up review) — shared by the dashboard route and the Discord
 * Confirm/Dismiss buttons, so both enforce the same rules.
 *
 * `confirm` folds it into that war's strike (creating the strike or appending the violation to an
 * existing one — NEVER a second strike for the same war); `dismiss` closes it without a strike. Either
 * way the suggestion keeps its dedup_key, so the periodic scan never re-queues the same violation.
 *
 * Only a PENDING suggestion can be acted on, and the pending → reviewed transition is a conditional
 * update: two leaders clicking at once (dashboard and Discord, or two Discord clients) race on that
 * one row, and exactly one of them wins. A confirm whose strike then fails to write hands the
 * suggestion back to pending, so it can be retried rather than sitting "confirmed" with no strike.
 */

export type ReviewAction = 'confirm' | 'dismiss';
export type ReviewStatus = 'pending' | 'confirmed' | 'dismissed';

export type ReviewOutcome =
  | { ok: true; status: 'confirmed' | 'dismissed'; strikeId: string | null }
  | { ok: false; code: 404 | 409 | 500; error: string; current?: { status: ReviewStatus; reviewedBy: string | null } };

type SuggestionRow = {
  id: string;
  status: ReviewStatus;
  reviewed_by: string | null;
  rule_id: string | null;
  person_id: string;
  player_account_tag: string | null;
  clan_id: string | null;
  war_source: string;
  war_round_id: string | null;
  war_label: string | null;
  description: string;
  dedup_key: string;
  occurred_at: string | null;
  member_name: string | null;
};

export async function reviewSuggestion(id: string, action: ReviewAction, actorTag: string): Promise<ReviewOutcome> {
  const { data: sug, error: loadErr } = await supabase.from('strike_suggestions').select('*').eq('id', id).maybeSingle();
  if (loadErr) return { ok: false, code: 500, error: loadErr.message };
  if (!sug) return { ok: false, code: 404, error: 'Suggestion not found' };
  const row = sug as SuggestionRow;
  if (row.status !== 'pending') return alreadyReviewed(row);

  const status = action === 'confirm' ? 'confirmed' : 'dismissed';
  const reviewed = { reviewed_by: actorTag, reviewed_at: new Date().toISOString() };

  // Claim it. Zero rows back means someone else got there between the read and now.
  const { data: claimed, error: claimErr } = await supabase
    .from('strike_suggestions')
    .update({ status, ...reviewed })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id');
  if (claimErr) return { ok: false, code: 500, error: claimErr.message };
  if (!claimed?.length) {
    const { data: now } = await supabase.from('strike_suggestions').select('status, reviewed_by').eq('id', id).maybeSingle();
    return alreadyReviewed((now as SuggestionRow | null) ?? row);
  }

  if (action === 'dismiss') return { ok: true, status: 'dismissed', strikeId: null };

  // Resolve the rule name for the strike's Discord notice first.
  const { data: rule } = row.rule_id
    ? await supabase.from('rules').select('name').eq('id', row.rule_id).maybeSingle()
    : { data: null };

  const { strikeId } = await commitReviewStrike({
    personId: row.person_id,
    playerTag: row.player_account_tag,
    clanId: row.clan_id,
    ruleId: row.rule_id,
    ruleName: (rule as { name: string } | null)?.name ?? null,
    warSource: row.war_source,
    warRoundId: row.war_round_id,
    warLabel: row.war_label,
    description: row.description,
    dedupKey: row.dedup_key,
    occurredAt: row.occurred_at,
    memberName: row.member_name,
    actorTag,
  });
  if (!strikeId) {
    await supabase
      .from('strike_suggestions')
      .update({ status: 'pending', reviewed_by: null, reviewed_at: null })
      .eq('id', id);
    return { ok: false, code: 500, error: 'Failed to record the strike' };
  }

  const { error: linkErr } = await supabase.from('strike_suggestions').update({ strike_id: strikeId }).eq('id', id);
  if (linkErr) console.error('Strike suggestion confirmed but not linked to its strike:', linkErr);
  return { ok: true, status: 'confirmed', strikeId };
}

function alreadyReviewed(row: Pick<SuggestionRow, 'status' | 'reviewed_by'>): ReviewOutcome {
  return {
    ok: false,
    code: 409,
    error: `Already ${row.status}`,
    current: { status: row.status, reviewedBy: row.reviewed_by },
  };
}
