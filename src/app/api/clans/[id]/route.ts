import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';
import type { RuleAutomationMode } from '@/types/database';

const RULE_AUTOMATION_MODES: RuleAutomationMode[] = ['always', 'cwl_only', 'never'];

// PATCH /api/clans/:id — update a clan's config. Currently only `rule_automation_mode` (whether the
// rule detectors act on this clan's wars: always / cwl_only / never). Gated by clan management.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireAuth(request);
    await requireCapability(auth, 'clan.create');

    const body = await request.json().catch(() => ({}));
    if (!('rule_automation_mode' in body)) {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }
    const mode = body.rule_automation_mode;
    if (!RULE_AUTOMATION_MODES.includes(mode)) {
      return NextResponse.json({ error: 'Invalid rule_automation_mode' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('clans')
      .update({ rule_automation_mode: mode })
      .eq('id', id)
      .select('id, rule_automation_mode')
      .single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return authErrorResponse(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  }
}

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
