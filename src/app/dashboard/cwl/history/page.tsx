'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { History, ArrowLeft, Activity } from 'lucide-react';
import type { CWLSeason, CWLRound, CWLWarMember } from '@/types/database';
import { computeCareerStats, type CareerHistory } from '@/lib/cwl/history';
import HistoryView from '@/components/cwl/HistoryView';

export default function CWLHistoryPage() {
  const [history, setHistory] = useState<CareerHistory | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/views/cwl/history');
      if (!res.ok) throw new Error(`CWL history load failed (${res.status})`);
      const data = await res.json();
      const seasons = (data.seasons as CWLSeason[]) || [];
      const rounds = (data.rounds as CWLRound[]) || [];
      // The in-game ACCOUNT name is left alone. This used to overwrite it with the linked
      // person's display name, which read fine while the career table merged a person's alts
      // into one row — but the table is now one row per account, and the override made every
      // alt of a person carry the same name, three identical-looking rows distinguishable only
      // by tag. The account name is the identity of the thing each row is actually counting.
      const members = (data.members as CWLWarMember[]) || [];

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

  const hasData = history && history.perAccount.length > 0;

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
