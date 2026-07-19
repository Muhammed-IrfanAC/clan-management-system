import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';
import { loadCapabilityOverrides, invalidateCapabilityCache } from '@/lib/permissions-server';
import { can, CONFIGURABLE_CO_LEADER_CAPS, Capability } from '@/lib/permissions';

/**
 * Configure the CO-LEADER capability set.
 *
 * Only capabilities in CONFIGURABLE_CO_LEADER_CAPS may be toggled, and only for the co_leader role —
 * super_admin and leader stay coded, and `role.assign_any` is never configurable, so the single-owner
 * model holds. Gated on `role.assign_any` (super_admin): deciding what co-leaders can do is an
 * owner-level action.
 */

// The effective on/off state for each configurable co-leader capability (coded default + override).
async function coLeaderState(): Promise<Record<string, boolean>> {
  const overrides = await loadCapabilityOverrides();
  const state: Record<string, boolean> = {};
  for (const cap of CONFIGURABLE_CO_LEADER_CAPS) state[cap] = can('co_leader', cap, overrides);
  return state;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    await requireCapability(auth, 'role.assign_any');
    return NextResponse.json({ capabilities: await coLeaderState() });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    await requireCapability(auth, 'role.assign_any');

    const body = await request.json();
    const capability = body?.capability as Capability;
    const enabled = !!body?.enabled;

    if (!CONFIGURABLE_CO_LEADER_CAPS.includes(capability)) {
      return NextResponse.json({ error: 'That capability is not configurable for co-leaders' }, { status: 400 });
    }

    const { error } = await supabase
      .from('role_capabilities')
      .upsert({ role: 'co_leader', capability, enabled, updated_at: new Date().toISOString() }, { onConflict: 'role,capability' });
    if (error) throw error;

    // The next authorization check must see the change immediately in this instance.
    invalidateCapabilityCache();

    return NextResponse.json({ capabilities: await coLeaderState() });
  } catch (error) {
    return authErrorResponse(error) ?? NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
