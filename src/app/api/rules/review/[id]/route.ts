import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { notifyWarningLogged, webhookUrlForClan } from '@/lib/discord';

/**
 * Act on a queued review suggestion: `confirm` promotes it to a real warning (and notifies the
 * member's clan channel), `dismiss` closes it without a warning. Either way the suggestion keeps its
 * dedup_key, so the periodic scan never re-queues the same violation. Only a PENDING suggestion can
 * be acted on (idempotent against double-clicks / concurrent leaders).
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
      .from('warning_suggestions')
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
        .from('warning_suggestions')
        .update({ status: 'dismissed', ...reviewed })
        .eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, status: 'dismissed' });
    }

    // Confirm: create the warning (attributed to the confirming leader) then link it to the
    // suggestion. dedup_key carries over so the warning is itself idempotent.
    const { data: warning, error: warnErr } = await supabase
      .from('warnings')
      .insert([{
        person_id: sug.person_id,
        player_account_tag: sug.player_account_tag,
        rule_id: sug.rule_id,
        description: sug.description,
        logged_by: auth.actorTag,
        logged_at: sug.occurred_at || new Date().toISOString(),
        acknowledged: false,
        source: 'auto',
        dedup_key: sug.dedup_key,
      }])
      .select()
      .single();
    if (warnErr) throw warnErr;

    const { error: updErr } = await supabase
      .from('warning_suggestions')
      .update({ status: 'confirmed', warning_id: warning.id, ...reviewed })
      .eq('id', id);
    if (updErr) throw updErr;

    // Best-effort notification to the member's clan channel (never blocks the confirm).
    try {
      const { data: rule } = sug.rule_id
        ? await supabase.from('rules').select('name').eq('id', sug.rule_id).maybeSingle()
        : { data: null };
      await notifyWarningLogged({
        memberName: sug.member_name,
        playerTag: sug.player_account_tag,
        ruleName: rule?.name ?? null,
        description: sug.description,
        loggedBy: 'ClanOps (leader-confirmed)',
        webhookUrl: await webhookUrlForClan(sug.clan_id),
      });
    } catch (err) {
      console.error('Confirm notify failed (non-fatal):', err);
    }

    return NextResponse.json({ success: true, status: 'confirmed', warning });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
