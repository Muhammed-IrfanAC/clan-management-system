import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('clanops-auth')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    try {
      await jwtVerify(token, JWT_SECRET);
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { playerTag, personId, newPersonName, isBaby } = await request.json();

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

    // Link account to person
    const { error: linkError } = await supabase
      .from('player_accounts')
      .update({ person_id: finalPersonId })
      .eq('player_tag', playerTag);

    if (linkError) throw linkError;

    return NextResponse.json({ success: true, personId: finalPersonId });

  } catch (error: any) {
    console.error('API Link Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
