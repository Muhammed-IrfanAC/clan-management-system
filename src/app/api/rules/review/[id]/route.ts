import { NextResponse, NextRequest } from 'next/server';
import { authorizeActive } from '@/lib/auth-server';
import { reviewSuggestion } from '@/lib/strikes/review';

/**
 * Act on a queued strike suggestion: `confirm` folds it into that war's strike, `dismiss` closes it
 * without one. The rules (pending-only, one winner when two leaders race, never a second strike for
 * a war) live in `lib/strikes/review.ts`, shared with the Discord review buttons.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { action } = await request.json();
    if (action !== 'confirm' && action !== 'dismiss') {
      return NextResponse.json({ error: 'action must be "confirm" or "dismiss"' }, { status: 400 });
    }

    const outcome = await reviewSuggestion(id, action, auth.actorTag!);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.code });
    return NextResponse.json({
      success: true,
      status: outcome.status,
      ...(outcome.strikeId ? { strikeId: outcome.strikeId } : {}),
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
