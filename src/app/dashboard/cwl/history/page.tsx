'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { History, ArrowLeft, Activity } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { CWLSeason, CWLRound, CWLWarMember } from '@/types/database';
import { computeCareerStats, type CareerHistory } from '@/lib/cwl/history';
import HistoryView from '@/components/cwl/HistoryView';

export default function CWLHistoryPage() {
  const [history, setHistory] = useState<CareerHistory | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: seasonRows } = await supabase.from('cwl_seasons').select('*').order('created_at', { ascending: true });
      const seasons = (seasonRows as CWLSeason[]) || [];

      let rounds: CWLRound[] = [];
      let members: CWLWarMember[] = [];

      if (seasons.length) {
        const { data: roundRows } = await supabase.from('cwl_rounds').select('*').in('season_id', seasons.map((s) => s.id));
        rounds = (roundRows as CWLRound[]) || [];

        if (rounds.length) {
          const { data: memberRows } = await supabase.from('cwl_war_members').select('*').in('round_id', rounds.map((r) => r.id));
          members = (memberRows as CWLWarMember[]) || [];

          // Prefer the family person's display name over the raw in-game name for linked accounts
          // (same resolution as SeasonView).
          const personIds = Array.from(new Set(members.map((m) => m.person_id).filter((x): x is string => !!x)));
          if (personIds.length) {
            const { data: personRows } = await supabase.from('persons').select('id, display_name').in('id', personIds);
            const nameById = new Map((personRows as { id: string; display_name: string }[] | null || []).map((p) => [p.id, p.display_name]));
            members = members.map((m) => ({ ...m, name: (m.person_id && nameById.get(m.person_id)) || m.name }));
          }
        }
      }

      setHistory(computeCareerStats(seasons, rounds, members));
    } catch (err) {
      console.error('CWL history load error:', err);
      setHistory(computeCareerStats([], [], []));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    load();
  }, [load]);

  const hasData = history && history.perPerson.length > 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <History size={22} className="text-cta" />
            <h1 style={{ fontSize: '2rem', margin: 0 }}>CWL History &amp; Trends</h1>
          </div>
          <p className="text-muted" style={{ margin: '4px 0 0' }}>Every member's war record across all seasons — attendance, stars and repeat missed attacks.</p>
        </div>
        <Link href="/dashboard/cwl" className="btn btn-outline" style={{ textDecoration: 'none' }}>
          <ArrowLeft size={16} /> Seasons
        </Link>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-3xl)' }}>
          <Activity className="animate-spin text-muted" size={24} />
        </div>
      ) : hasData ? (
        <HistoryView history={history!} />
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <History size={32} className="text-muted" style={{ marginBottom: 'var(--space-md)' }} />
          <h3 style={{ margin: '0 0 var(--space-xs)' }}>No CWL history yet</h3>
          <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: 'var(--space-lg)' }}>History appears after your first synced season — run a sync during CWL week to pull round data.</p>
          <Link href="/dashboard/cwl" className="btn btn-primary" style={{ textDecoration: 'none' }}><ArrowLeft size={16} /> Back to seasons</Link>
        </div>
      )}
    </div>
  );
}
