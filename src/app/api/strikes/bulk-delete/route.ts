import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hasCapability, authorizeActive as authorize } from '@/lib/auth-server';

/**
 * Bulk-delete strikes (each cascades to its violations/notes). Unlike single delete — which the
 * strike's own author may perform — a bulk sweep is a leadership-only action: it is gated purely on
 * the 'content.override' capability, which only leaders and super admins hold. There is deliberately
 * no per-strike author check, so leadership can clear out anyone's strikes in one pass.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (auth.error) return auth.error;

    if (!(await hasCapability(auth.actorTag!, 'content.override'))) {
      return NextResponse.json(
        { error: 'Only leaders and super admins can bulk-delete strikes' },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray((body as { ids?: unknown })?.ids)
      ? [...new Set((body as { ids: unknown[] }).ids.filter((x): x is string => typeof x === 'string' && !!x))]
      : [];
    if (!ids.length) return NextResponse.json({ error: 'No strike ids provided' }, { status: 400 });

    const { error } = await supabase.from('strikes').delete().in('id', ids);
    if (error) throw error;
    return NextResponse.json({ success: true, deleted: ids.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
