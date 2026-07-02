import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { addOnboardingEvent, MANUAL_EVENT_TYPES } from '@/lib/onboarding';
import { hasCapability, authorizeActive as authorize } from '@/lib/auth-server';
import { OnboardingEventType } from '@/types/database';

// Resolve a player_tag to the person (persona) it is linked to, if any.
async function personIdForTag(tag: string): Promise<string | null> {
  const { data } = await supabase
    .from('player_accounts')
    .select('person_id')
    .eq('player_tag', tag)
    .maybeSingle();
  return data?.person_id ?? null;
}

// POST: record one onboarding event for a member, attributed to the acting leader.
// `promoted_elder` is rejected here — graduation is emitted only by clan sync.
export async function POST(request: NextRequest, { params }: { params: Promise<{ personId: string }> }) {
  try {
    const { personId } = await params;
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    const { eventType, outcome, clanId, accountTag } = await request.json();

    if (!MANUAL_EVENT_TYPES.includes(eventType as OnboardingEventType)) {
      return NextResponse.json({ error: 'Unsupported onboarding event type' }, { status: 400 });
    }

    const data = await addOnboardingEvent({
      personId,
      eventType,
      actorTag: auth.actorTag!,
      outcome: outcome ?? null,
      clanId: clanId ?? null,
      accountTag: accountTag ?? null,
    });
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API Onboarding Event Error:', error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

// DELETE ?eventId=<id>: undo a mis-recorded event. Author-only, resolved at the person level so
// alts of the original author can undo too (mirrors member-notes ownership). The system-emitted
// `promoted_elder` event cannot be deleted.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ personId: string }> }) {
  try {
    const { personId } = await params;
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    const eventId = request.nextUrl.searchParams.get('eventId');
    if (!eventId) return NextResponse.json({ error: 'eventId is required' }, { status: 400 });

    const { data: event } = await supabase
      .from('onboarding_events')
      .select('id, person_id, event_type, actor_tag')
      .eq('id', eventId)
      .eq('person_id', personId)
      .maybeSingle();
    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

    if (event.event_type === 'promoted_elder') {
      return NextResponse.json({ error: 'Promotion events are recorded by sync and cannot be deleted' }, { status: 403 });
    }

    // Author-only: same account, or an alt sharing the author's persona.
    if (event.actor_tag !== auth.actorTag) {
      const [authorPerson, actorPerson] = await Promise.all([
        event.actor_tag ? personIdForTag(event.actor_tag) : Promise.resolve(null),
        personIdForTag(auth.actorTag!),
      ]);
      if ((!authorPerson || !actorPerson || authorPerson !== actorPerson) && !(await hasCapability(auth.actorTag!, 'content.override'))) {
        return NextResponse.json({ error: 'Only the leader who recorded this event can remove it' }, { status: 403 });
      }
    }

    const { error } = await supabase.from('onboarding_events').delete().eq('id', eventId);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('API Onboarding Event Error:', error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
