import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;
    const { error } = await supabase.from('rules').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
