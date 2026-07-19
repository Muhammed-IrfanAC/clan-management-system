import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { notifyStrikeLogged, webhookUrlForClan, discordUserIdForPerson } from '@/lib/discord';
import { loadStrikeNotifyContext } from '@/lib/strikes/notify-context';

/**
 * Strikes collection endpoint (the Strike system replacing Warnings).
 *
 * GET  — every strike with its folded violations, notes, person/rule/account context. Status
 *        (active count, colour, war eligibility) is DERIVED client-side/in the dossier from
 *        issued_at + leadership_approved via lib/strikes/status.ts; nothing is cached here.
 * POST — log a MANUAL strike (a leader recording an off-detector rule break). Manual strikes carry
 *        war_source 'manual' and no strike_key, so they never collide with or fold into auto strikes.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { data, error } = await supabase
      .from('strikes')
      .select(`
        *,
        person:persons (*),
        rule:rules (*),
        player_account:player_accounts (*),
        strike_violations (*),
        strike_notes (*)
      `)
      .order('issued_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { personId, playerTag, ruleId, description, issuedAt } = await request.json();
    if (!personId || !playerTag) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const descriptionText = String(description ?? '').trim();

    // Optional backdating: a supplied date must be valid and not in the future.
    let issuedAtIso = new Date().toISOString();
    if (issuedAt) {
      const parsed = new Date(issuedAt);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid date provided' }, { status: 400 });
      }
      if (parsed.getTime() > Date.now()) {
        return NextResponse.json({ error: 'Strike date cannot be in the future' }, { status: 400 });
      }
      issuedAtIso = parsed.toISOString();
    }

    // Resolve the member's clan (for Discord routing) from their account.
    const { data: account } = await supabase
      .from('player_accounts')
      .select('in_game_name, clan_id')
      .eq('player_tag', playerTag)
      .maybeSingle();

    const { data: strike, error } = await supabase
      .from('strikes')
      .insert([{
        person_id: personId,
        player_account_tag: playerTag,
        clan_id: account?.clan_id ?? null,
        rule_id: ruleId || null,
        war_source: 'manual',
        origin: 'manual',
        issued_at: issuedAtIso,
        logged_by: auth.actorTag,
      }])
      .select()
      .single();
    if (error) throw error;

    // Record the reason as the strike's first violation so it shows in the folded list like any other.
    if (descriptionText) {
      const { error: vErr } = await supabase.from('strike_violations').insert([{
        strike_id: strike.id,
        rule_id: ruleId || null,
        description: descriptionText,
        evidence: {},
        dedup_key: `manual:${strike.id}`,
        occurred_at: issuedAtIso,
        source: 'manual',
      }]);
      if (vErr) console.error('Manual strike-violation insert failed (non-fatal):', vErr);
    }

    // Best-effort Discord ping to the member's clan channel (never blocks the log).
    try {
      const { data: rule } = ruleId
        ? await supabase.from('rules').select('name').eq('id', ruleId).maybeSingle()
        : { data: null };
      const ctx = await loadStrikeNotifyContext(playerTag);
      await notifyStrikeLogged({
        memberName: account?.in_game_name,
        playerTag,
        ruleName: rule?.name ?? null,
        reasons: descriptionText ? [descriptionText] : [],
        strikeNumber: ctx.strikeNumber,
        level: ctx.level,
        activeStrikes: ctx.activeStrikes,
        webhookUrl: await webhookUrlForClan(account?.clan_id),
        mentionDiscordId: await discordUserIdForPerson(personId),
      });
    } catch (notifyErr) {
      console.error('Manual strike Discord notification failed (non-fatal):', notifyErr);
    }

    return NextResponse.json(strike);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
