import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';
import { DETECTOR_REGISTRY } from '@/lib/rules/registry';

/**
 * Update a rule — its text and/or its automation wiring. `automation_key` may only be null (manual)
 * or a key from the built-in detector registry; anything else is rejected so a rule can never point
 * at logic that doesn't exist. Enabling is a separate explicit flag, so attaching a detector never
 * starts logging on its own.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const body = await request.json();
    const patch: Record<string, unknown> = {};
    if ('name' in body) patch.name = body.name;
    if ('description' in body) patch.description = body.description;
    if ('logging_guidance' in body) patch.logging_guidance = body.logging_guidance;
    if ('automation_key' in body) {
      const key = body.automation_key;
      if (key !== null && !DETECTOR_REGISTRY.some((d) => d.key === key)) {
        return NextResponse.json({ error: 'Unknown automation detector' }, { status: 400 });
      }
      patch.automation_key = key;
    }
    if ('automation_enabled' in body) patch.automation_enabled = !!body.automation_enabled;
    if ('automation_config' in body) patch.automation_config = body.automation_config ?? {};

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase.from('rules').update(patch).eq('id', id).select().single();
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

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
