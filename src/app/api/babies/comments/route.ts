import { NextResponse, NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { addBabyComment } from '@/lib/babies';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

// POST: add a comment to a baby's thread. Attributed to the acting leader's player_tag.
// Rejected (by addBabyComment) if the persona is not currently in its baby trial.
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

    const data = await addBabyComment({ personId, authorTag: actorTag, body });
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('API Baby Comment Error:', error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
