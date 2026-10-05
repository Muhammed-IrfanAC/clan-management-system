import { NextResponse, NextRequest } from 'next/server';
import { authorizeActive } from '@/lib/auth-server';
import { KickListError, removeKick, updateKickComment } from '@/lib/kicks/kickList';

function errorResponse(error: unknown) {
  if (error instanceof KickListError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('API Kick List Error:', error);
  return NextResponse.json({ error: (error as Error).message }, { status: 500 });
}

// PATCH { comment }: replace the entry's comment (blank clears it). Returns the updated entry.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tag: string }> }) {
  try {
    const { tag } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;
    const { comment } = await request.json().catch(() => ({}));
    if (comment !== null && typeof comment !== 'string') {
      return NextResponse.json({ error: 'comment must be a string' }, { status: 400 });
    }
    return NextResponse.json(await updateKickComment(decodeURIComponent(tag), comment));
  } catch (error) {
    return errorResponse(error);
  }
}

// DELETE: take the account (and with it the alts it watched) off the list.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tag: string }> }) {
  try {
    const { tag } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;
    await removeKick(decodeURIComponent(tag));
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
