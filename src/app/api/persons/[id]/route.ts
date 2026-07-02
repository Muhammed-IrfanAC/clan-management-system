import { NextResponse, NextRequest } from 'next/server';
import { authorizeActive } from '@/lib/auth-server';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    // Promotion is no longer a manual action — babies auto-graduate when clan sync detects an
    // in-game promotion to Elder (see src/lib/sync.ts). No manual person actions remain.
    await request.json().catch(() => ({}));
    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error: any) {
    console.error('API Person Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
