import { NextResponse, NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase';
import { authorizeActiveView } from '@/lib/auth-server';

/**
 * The raw rows behind the CWL career history: every season (oldest first), their rounds, and those
 * rounds' war members. The page rolls them up per account with the pure `computeCareerStats`.
 */
export async function GET(request: NextRequest) {
  try {
    // The live role check runs alongside these reads (see authorizeActiveView).
    const view = await authorizeActiveView(request, async () => {
      const { data: seasons, error: seasonsError } = await supabase.from('cwl_seasons').select('*').order('created_at', { ascending: true });
      if (seasonsError) throw seasonsError;

      let rounds: { id: string }[] = [];
      let members: unknown[] = [];
      if (seasons?.length) {
        const { data, error } = await supabase.from('cwl_rounds').select('*').in('season_id', seasons.map((s) => s.id));
        if (error) throw error;
        rounds = data || [];
        if (rounds.length) {
          const { data: memberRows, error: membersError } = await supabase.from('cwl_war_members').select('*').in('round_id', rounds.map((r) => r.id));
          if (membersError) throw membersError;
          members = memberRows || [];
        }
      }

      return NextResponse.json({ seasons: seasons || [], rounds, members });
    });
    return view.error ?? view.data;
  } catch (error) {
    console.error('API CWL History View Error:', error);
    return NextResponse.json({ error: 'Failed to load CWL history' }, { status: 500 });
  }
}
