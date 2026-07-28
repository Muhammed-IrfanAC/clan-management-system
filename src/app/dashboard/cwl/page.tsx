'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Swords, Plus, Activity, History } from 'lucide-react';
import { useClan } from '@/lib/ClanContext';
import { useCWLStore } from '@/lib/stores/cwlStore';
import Toast from '@/components/ui/Toast';
import CreateSeasonForm from '@/components/cwl/CreateSeasonForm';
import SeasonView from '@/components/cwl/SeasonView';

/**
 * Thin 'use client' orchestrator over cwlStore: season list, create-vs-view mode, mount-time load.
 * Everything below SeasonView reads the store directly rather than receiving props.
 */
export default function CWLPage() {
  const { clans } = useClan();
  const seasons = useCWLStore((s) => s.seasons);
  const selectedSeasonId = useCWLStore((s) => s.selectedSeasonId);
  const selectSeason = useCWLStore((s) => s.selectSeason);
  const loadSeasons = useCWLStore((s) => s.loadSeasons);
  const loading = useCWLStore((s) => s.loadingSeasons);
  const toast = useCWLStore((s) => s.toast);
  const setToast = useCWLStore((s) => s.setToast);

  const [mode, setMode] = useState<'view' | 'create'>('view');

  useEffect(() => {
    loadSeasons();
  }, [loadSeasons]);

  const selectedSeason = seasons.find((s) => s.id === selectedSeasonId) || null;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
            <Swords size={22} className="text-cta" />
            <h1 style={{ fontSize: '2rem', margin: 0 }}>Clan War League</h1>
          </div>
          <p className="text-muted" style={{ margin: '4px 0 0' }}>Plan rosters, transfers and lineups across the family. Every in-game step stays manual.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          {mode === 'view' && seasons.length > 0 && (
            <select className="input" style={{ width: 'auto', padding: '8px 12px' }} value={selectedSeasonId ?? ''} onChange={(e) => selectSeason(e.target.value)}>
              {seasons.map((s) => <option key={s.id} value={s.id}>CWL {s.label}</option>)}
            </select>
          )}
          {mode === 'view' && (
            <Link href="/dashboard/cwl/history" className="btn btn-outline" style={{ textDecoration: 'none' }}>
              <History size={16} /> History &amp; Trends
            </Link>
          )}
          {mode === 'view' && (
            <button className="btn btn-primary" onClick={() => setMode('create')}>
              <Plus size={16} /> New Season
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-3xl)' }}>
          <Activity className="animate-spin text-muted" size={24} />
        </div>
      ) : mode === 'create' ? (
        <CreateSeasonForm
          clans={clans}
          onCreated={() => setMode('view')}
          onCancel={() => setMode('view')}
        />
      ) : selectedSeason ? (
        <SeasonView key={selectedSeason.id} season={selectedSeason} />
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-2xl)' }}>
          <Swords size={32} className="text-muted" style={{ marginBottom: 'var(--space-md)' }} />
          <h3 style={{ margin: '0 0 var(--space-xs)' }}>No CWL seasons yet</h3>
          <p className="text-muted" style={{ fontSize: '0.9rem', marginBottom: 'var(--space-lg)' }}>Create a season to generate a recommended roster allocation across your clans.</p>
          <button className="btn btn-primary" onClick={() => setMode('create')}><Plus size={16} /> Create your first season</button>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
