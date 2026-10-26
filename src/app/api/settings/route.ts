import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuth, requireCapability, authErrorResponse } from '@/lib/auth-server';
import { ROUTE_SETTING_KEYS } from '@/lib/discord/routing';

/**
 * PATCH { key, value }: change one row of the General tab's settings. The tab used to write these
 * straight through PostgREST from the browser; it now goes through here, gated on `leader.manage`
 * like the rest of system configuration (the tab is only shown to that capability).
 *
 * Only an existing key can be written, and only with a value of the type it already holds — the tab
 * renders booleans as a toggle and everything else as a number, so that is what it may store. The
 * Discord routing keys are refused: /api/settings/discord-route validates those and drops the
 * transport's routing cache, which a write from here would skip.
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    await requireCapability(auth, 'leader.manage');

    const { key, value } = await request.json().catch(() => ({}));
    if (typeof key !== 'string' || !key) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }
    if ((ROUTE_SETTING_KEYS as readonly string[]).includes(key)) {
      return NextResponse.json({ error: 'Discord routing is configured through its own control' }, { status: 400 });
    }

    const { data: row, error: readError } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
    if (readError) throw readError;
    if (!row) return NextResponse.json({ error: 'Unknown setting' }, { status: 404 });

    const valid = typeof row.value === 'boolean'
      ? typeof value === 'boolean'
      : typeof value === 'number' && Number.isFinite(value);
    if (!valid) return NextResponse.json({ error: 'Invalid value for this setting' }, { status: 400 });

    const { error } = await supabase.from('settings').update({ value }).eq('key', key);
    if (error) throw error;
    return NextResponse.json({ key, value });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('API Settings Error:', error);
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 });
  }
}
