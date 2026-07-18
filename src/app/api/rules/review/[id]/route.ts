import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { commitReviewStrike } from '@/lib/strikes/commit';

/**
 * Act on a queued strike suggestion: `confirm` folds it into that war's strike (creating the strike
 * or appending the violation to an existing one — NEVER a second strike for the same war), `dismiss`
 * closes it without a strike. Either way the suggestion keeps its dedup_key, so the periodic scan
 * never re-queues the same violation. Only a PENDING suggestion can be acted on (idempotent against
 * double-clicks / concurrent leaders).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { action } = await request.json();
    if (action !== 'confirm' && action !== 'dismiss') {
      return NextResponse.json({ error: 'action must be "confirm" or "dismiss"' }, { status: 400 });
    }

    const { data: sug, error: loadErr } = await supabase
      .from('strike_suggestions')
      .select('*')
      .eq('id', id)
      .single();
    if (loadErr || !sug) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    if (sug.status !== 'pending') {
      return NextResponse.json({ error: `Already ${sug.status}` }, { status: 409 });
    }

    const reviewed = { reviewed_by: auth.actorTag, reviewed_at: new Date().toISOString() };

    if (action === 'dismiss') {
      const { error } = await supabase
        .from('strike_suggestions')
        .update({ status: 'dismissed', ...reviewed })
        .eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, status: 'dismissed' });
    }

    // Confirm: fold into the (person, war) strike. Resolve the rule name for the Discord ping first.
    const { data: rule } = sug.rule_id
      ? await supabase.from('rules').select('name').eq('id', sug.rule_id).maybeSingle()
      : { data: null };

    const { strikeId } = await commitReviewStrike({
      personId: sug.person_id,
      playerTag: sug.player_account_tag,
      clanId: sug.clan_id,
      ruleId: sug.rule_id,
      ruleName: rule?.name ?? null,
      warSource: sug.war_source,
      warRoundId: sug.war_round_id,
      warLabel: sug.war_label,
      description: sug.description,
      dedupKey: sug.dedup_key,
      occurredAt: sug.occurred_at,
      memberName: sug.member_name,
      actorTag: auth.actorTag!,
    });
    if (!strikeId) {
      return NextResponse.json({ error: 'Failed to record the strike' }, { status: 500 });
    }

    const { error: updErr } = await supabase
      .from('strike_suggestions')
      .update({ status: 'confirmed', strike_id: strikeId, ...reviewed })
      .eq('id', id);
    if (updErr) throw updErr;

    return NextResponse.json({ success: true, status: 'confirmed', strikeId });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
