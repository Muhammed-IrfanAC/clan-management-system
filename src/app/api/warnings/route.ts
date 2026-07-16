import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { notifyWarningLogged, webhookUrlForClan } from '@/lib/discord';

export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get('clanops-auth')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const { data: warnings, error } = await supabase
      .from('warnings')
      .select(`
        *,
        person:persons (*),
        rule:rules (*),
        player_account:player_accounts (*),
        warning_notes (*)
      `)
      .order('logged_at', { ascending: false });

    if (error) throw error;
    return NextResponse.json(warnings);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { personId, playerTag, ruleId, description, loggedAt } = await request.json();

    if (!personId || !playerTag) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    // Description is optional — the column is NOT NULL, so an omitted note stores as an empty string.
    const descriptionText = String(description ?? '').trim();

    // Optional backdating: if a loggedAt is supplied it must be a valid date in the
    // past (you can't log a violation in the future). Blank => log as "now".
    let loggedAtIso = new Date().toISOString();
    if (loggedAt) {
      const parsed = new Date(loggedAt);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json({ error: 'Invalid date provided' }, { status: 400 });
      }
      if (parsed.getTime() > Date.now()) {
        return NextResponse.json({ error: 'Warning date cannot be in the future' }, { status: 400 });
      }
      loggedAtIso = parsed.toISOString();
    }

    const { data, error } = await supabase
      .from('warnings')
      .insert([{
        person_id: personId,
        player_account_tag: playerTag,
        rule_id: ruleId || null,
        description: descriptionText,
        logged_by: auth.actorTag,
        logged_at: loggedAtIso,
        acknowledged: false
      }])
      .select()
      .single();

    if (error) throw error;

    // Best-effort Discord notification. Enrich for a readable message and route to the warned
    // member's clan channel; every lookup and the send itself are fail-safe so they can never
    // break the log request.
    try {
      const [{ data: account }, ruleResult, actorResult] = await Promise.all([
        // Member's account → in-game name + clan (which channel to post to).
        supabase
          .from('player_accounts')
          .select('in_game_name, clan_id')
          .eq('player_tag', playerTag)
          .maybeSingle(),
        ruleId
          ? supabase.from('rules').select('name').eq('id', ruleId).maybeSingle()
          : Promise.resolve({ data: null }),
        // Actor's account → person display name, so "Logged by" reads a name, not a raw tag.
        supabase
          .from('player_accounts')
          .select('person:persons(display_name)')
          .eq('player_tag', auth.actorTag)
          .maybeSingle(),
      ]);

      const loggedByName =
        (actorResult.data?.person as { display_name?: string } | null)?.display_name || auth.actorTag;

      await notifyWarningLogged({
        memberName: account?.in_game_name,
        playerTag,
        ruleName: ruleResult.data?.name,
        description,
        loggedBy: loggedByName,
        webhookUrl: await webhookUrlForClan(account?.clan_id),
        // TODO: enable member @-mentions later — fetch the warned person's discord_user_id
        // (persons.discord_user_id, by personId) and pass it as `mentionDiscordId`. Dormant for now.
      });
    } catch (notifyErr) {
      console.error('Warning Discord notification failed (non-fatal):', notifyErr);
    }

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
