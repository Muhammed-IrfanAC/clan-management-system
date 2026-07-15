import { NextResponse, NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { runFullSync } from '@/lib/sync';

/**
 * Machine-auth sync endpoint for external schedulers (e.g. cron-job.org hitting this every 5 min).
 *
 * Unlike `/api/sync`, there is NO cookie and NO dashboard-role check — a scheduler has no session.
 * Auth is a single shared secret sent as `Authorization: Bearer <CRON_SECRET>`. Because this bypasses
 * the person/role model entirely, it must ONLY ever run the sync flow and never anything that trusts
 * an actor identity. Keep it that way.
 */

// Full-family sync fans out CoC API calls across every clan; give it more than the 10s default.
export const maxDuration = 60;

/** Constant-time comparison so a caller can't time-probe the secret byte by byte. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, so guard length first (length is not secret).
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  // Fail closed: an unset secret must never mean "open", it means this endpoint is disabled.
  if (!expected) {
    console.error('CRON_SECRET is not set — /api/cron/sync is disabled.');
    return false;
  }
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return false;
  return secretMatches(header.slice('Bearer '.length), expected);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json(await runFullSync());
  } catch (error: any) {
    console.error('Cron Sync Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
