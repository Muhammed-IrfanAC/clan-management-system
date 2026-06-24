import { NextResponse, NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { promoteBaby, logBabyAction, clanIdForPerson } from '@/lib/babies';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-for-dev-only');

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const token = request.cookies.get('clanops-auth')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let actorTag: string | undefined;
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET);
      actorTag = payload.playerTag as string | undefined;
    } catch (e) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const { action } = await request.json();

    if (action === 'promote') {
      const data = await promoteBaby(id);
      // Credit the acting leader for converting a baby to a permanent member.
      await logBabyAction({
        loggedBy: actorTag,
        category: 'promotion',
        personId: id,
        clanId: await clanIdForPerson(id),
        description: `Promoted baby to permanent: ${data?.display_name ?? 'member'}`,
      });
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error: any) {
    console.error('API Person Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
