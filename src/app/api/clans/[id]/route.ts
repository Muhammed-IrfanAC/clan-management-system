import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireAuth(request);
    await requireCapability(auth, 'clan.create');
    const { error } = await supabase.from('clans').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return authErrorResponse(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }
}
