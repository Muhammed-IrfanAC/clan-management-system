import { NextResponse, NextRequest } from 'next/server';
import { authorizeActive } from '@/lib/auth-server';
import { addMemberNote } from '@/lib/babies';

// POST: add a note to a member's thread. Attributed to the acting leader's player_tag.
// Available for every member (baby-phase notes carry forward after promotion).
export async function POST(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;
    const actorTag = auth.actorTag;

    const { personId, body } = await request.json();
    if (!personId) return NextResponse.json({ error: 'personId is required' }, { status: 400 });

    const data = await addMemberNote({ personId, authorTag: actorTag, body });
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API Member Note Error:', error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
