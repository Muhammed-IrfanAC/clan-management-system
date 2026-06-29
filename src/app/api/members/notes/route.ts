import { NextResponse, NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { addMemberNote } from '@/lib/babies';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

// POST: add a note to a member's thread. Attributed to the acting leader's player_tag.
// Available for every member (baby-phase notes carry forward after promotion).
export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get('clanops-auth')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let actorTag: string | undefined;
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      actorTag = payload.playerTag as string | undefined;
    } catch {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }
    if (!actorTag) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });

    const { personId, body } = await request.json();
    if (!personId) return NextResponse.json({ error: 'personId is required' }, { status: 400 });

    const data = await addMemberNote({ personId, authorTag: actorTag, body });
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API Member Note Error:', error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
