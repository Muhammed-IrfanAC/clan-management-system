import { NextResponse, NextRequest } from 'next/server';
import { runFullSync } from '@/lib/sync';
import { authorizeActive } from '@/lib/auth-server';

// Same pipeline as /api/cron/sync, so the same budget (lib/sync.ts stops starting work at 50s).
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check (identity + live dashboard access)
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    let clanId;
    try {
      const body = await request.json();
      clanId = body.clanId;
    } catch (e) {
      // Body is empty or not JSON, continue with clanId = undefined
    }

    return NextResponse.json(await runFullSync(clanId));

  } catch (error: any) {
    console.error('API Sync Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
