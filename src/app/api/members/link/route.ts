import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { jwtVerify } from 'jose';
import { logBabyAction, addBabyComment } from '@/lib/babies';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('clanops-auth')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let actorTag: string | undefined;
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      actorTag = payload.playerTag as string | undefined;
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { playerTag, personId, newPersonName, isBaby, comment } = await request.json();

    if (!playerTag) return NextResponse.json({ error: 'Player tag is required' }, { status: 400 });

    let finalPersonId = personId;

    // Create new person if requested. A brand-new person can be flagged as a "baby"
    // (probationary), which starts the promotion countdown. Linking to an EXISTING person
    // is treated as an alt link and never triggers a trial.
    if (!personId && newPersonName) {
      const { data: newPerson, error: personError } = await supabase
        .from('persons')
        .insert([{
          display_name: newPersonName,
          is_baby: !!isBaby,
          baby_started_at: isBaby ? new Date().toISOString() : null,
        }])
        .select()
        .single();

      if (personError) throw personError;
      finalPersonId = newPerson.id;
    }

    if (!finalPersonId) return NextResponse.json({ error: 'Person ID or New Person Name is required' }, { status: 400 });

    // Link account to person. Capture the account's clan so the recruitment log
    // is attributed to the right clan for clan-filtered graphs.
    const { data: linkedAccount, error: linkError } = await supabase
      .from('player_accounts')
      .update({ person_id: finalPersonId })
      .eq('player_tag', playerTag)
      .select('clan_id')
      .maybeSingle();

    if (linkError) throw linkError;

    // Credit the acting leader for recruiting a new baby (probationary) member.
    if (!personId && newPersonName && isBaby) {
      await logBabyAction({
        loggedBy: actorTag,
        category: 'recruitment',
        personId: finalPersonId,
        clanId: linkedAccount?.clan_id ?? null,
        description: `Recruited new baby: ${newPersonName}`,
      });

      // Optional initial comment captured at link time. Non-fatal: a bad/empty note
      // must never break the link itself.
      if (actorTag && typeof comment === 'string' && comment.trim()) {
        try {
          await addBabyComment({ personId: finalPersonId, authorTag: actorTag, body: comment });
        } catch (e) {
          console.error('Failed to add initial baby comment:', e);
        }
      }
    }

    return NextResponse.json({ success: true, personId: finalPersonId });

  } catch (error: any) {
    console.error('API Link Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
