'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Users,
  TrendingUp,
  UserMinus,
  RefreshCw
} from 'lucide-react';
import { useClan } from '@/lib/ClanContext';
import { buildDossiers, buildWorklist, type StrikeWithContext } from '@/lib/strikes/dossier';
import LeadershipPerformance from '@/components/dashboard/LeadershipPerformance';

export default function DashboardPage() {
  const router = useRouter();
  const { selectedClanId } = useClan();

  // Make a stat card a shortcut into its underlying screen, with the relevant filter preset.
  const cardLinkProps = (href: string) => ({
    onClick: () => router.push(href),
    role: 'button' as const,
    tabIndex: 0,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push(href); }
    },
    style: { cursor: 'pointer' },
  });
  const [stats, setStats] = useState({
    warIneligible: 0,
    removalFlagged: 0,
    totalMembers: 0,
    unlinkedAccounts: 0
  });
  const [loading, setLoading] = useState(true);

  // Only the newest load may land: a clan switch while one is in flight must not let the older
  // response overwrite the clan now selected.
  const latestFetch = useRef(0);

  useEffect(() => {
    fetchData();
  }, [selectedClanId]);

  async function fetchData() {
    const request = ++latestFetch.current;
    const isCurrent = () => request === latestFetch.current;
    setLoading(true);
    try {
      // Member/unlinked counts and the strike rows, in one round trip (the route reads them in parallel).
      const res = await fetch(`/api/views/overview?clanId=${encodeURIComponent(selectedClanId)}`);
      if (!res.ok) throw new Error(`Overview load failed (${res.status})`);
      const data = await res.json();
      if (!isCurrent()) return;

      // Strike-derived counts: war-ineligible (active unresolved) and removal-flagged (3+ active).
      // Derived client-side via the same pure engine the Strikes page uses — grouped per ACCOUNT — so
      // the numbers agree with the Strikes screen.
      const dossiers = buildDossiers((data.strikes as StrikeWithContext[]) || [], new Date());
      const worklist = buildWorklist(dossiers, new Date());

      setStats({
        totalMembers: data.totalMembers || 0,
        warIneligible: worklist.unresolved.length,
        removalFlagged: worklist.removalFlagged.length,
        unlinkedAccounts: data.unlinkedAccounts || 0
      });

    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-2xl)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Commander Overview</h1>
          <p className="text-muted">
            {selectedClanId === 'all' ? 'Real-time status of your clan family.' : 'Monitoring activity for the selected clan.'}
          </p>
        </div>
        <button onClick={fetchData} className="btn btn-outline" style={{ border: 'none', color: 'var(--color-muted)' }}>
          <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Overview Stats */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', 
        gap: 'var(--space-lg)',
        marginBottom: 'var(--space-2xl)'
      }}>
        <div className="card" {...cardLinkProps('/dashboard/strikes?filter=removalFlagged')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <div style={{ padding: 'var(--space-sm)', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-md)' }}>
              <UserMinus color="var(--color-danger)" size={24} />
            </div>
            <span className="text-muted" style={{ fontWeight: '600', textTransform: 'uppercase', fontSize: '0.75rem' }}>Removal Flagged</span>
          </div>
          <h2 style={{ fontSize: '2.5rem', margin: 0 }}>{loading ? '...' : stats.removalFlagged}</h2>
          <p className="text-danger" style={{ fontSize: '0.75rem', marginTop: 'var(--space-sm)' }}>3+ active strikes</p>
        </div>

        <div className="card" {...cardLinkProps('/dashboard/strikes?filter=unresolved')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <div style={{ padding: 'var(--space-sm)', background: 'rgba(245, 158, 11, 0.1)', borderRadius: 'var(--radius-md)' }}>
              <AlertTriangle color="var(--color-warning)" size={24} />
            </div>
            <span className="text-muted" style={{ fontWeight: '600', textTransform: 'uppercase', fontSize: '0.75rem' }}>War-Ineligible</span>
          </div>
          <h2 style={{ fontSize: '2.5rem', margin: 0 }}>{loading ? '...' : stats.warIneligible}</h2>
          <p className="text-warning" style={{ fontSize: '0.75rem', marginTop: 'var(--space-sm)' }}>Active unresolved strike</p>
        </div>

        <div className="card" {...cardLinkProps('/dashboard/members')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <div style={{ padding: 'var(--space-sm)', background: 'rgba(34, 197, 94, 0.1)', borderRadius: 'var(--radius-md)' }}>
              <Users color="var(--color-cta)" size={24} />
            </div>
            <span className="text-muted" style={{ fontWeight: '600', textTransform: 'uppercase', fontSize: '0.75rem' }}>Total Members</span>
          </div>
          <h2 style={{ fontSize: '2.5rem', margin: 0 }}>{loading ? '...' : stats.totalMembers}</h2>
          <p className="text-cta" style={{ fontSize: '0.75rem', marginTop: 'var(--space-sm)' }}>Registered in registry</p>
        </div>

        <div className="card" {...cardLinkProps('/dashboard/members')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <div style={{ padding: 'var(--space-sm)', background: 'rgba(148, 163, 184, 0.1)', borderRadius: 'var(--radius-md)' }}>
              <TrendingUp color="var(--color-muted)" size={24} />
            </div>
            <span className="text-muted" style={{ fontWeight: '600', textTransform: 'uppercase', fontSize: '0.75rem' }}>Unlinked Accounts</span>
          </div>
          <h2 style={{ fontSize: '2.5rem', margin: 0 }}>{loading ? '...' : stats.unlinkedAccounts}</h2>
          <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 'var(--space-sm)' }}>Awaiting assignment</p>
        </div>
      </div>

      {/* Leadership Performance */}
      <LeadershipPerformance selectedClanId={selectedClanId} />
    </div>
  );
}
