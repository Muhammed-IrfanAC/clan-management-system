import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActive } from '@/lib/auth-server';

/**
 * Pending review queue for judgement-mode detectors (hit-up). Returns the not-yet-acted strike
 * suggestions with enough context (person, rule, war, evidence) for a leader to confirm or dismiss.
 * Confirming folds the suggestion into that war's strike (never a second strike); see [id]/route.ts.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeActive(request);
    if (auth.error) return auth.error;

    const { data, error } = await supabase
      .from('strike_suggestions')
      .select('*, person:persons(id, display_name), rule:rules(id, name)')
      .eq('status', 'pending')
      .order('detected_at', { ascending: false });
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
