'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  AlertTriangle,
  Users,
  TrendingUp,
  Clock,
  RefreshCw
} from 'lucide-react';
import { useClan } from '@/lib/ClanContext';
import LeadershipPerformance from '@/components/dashboard/LeadershipPerformance';

export default function DashboardPage() {
  const { selectedClanId } = useClan();
  const [stats, setStats] = useState({
    highWarnings: 0,
    pendingAcknowledge: 0,
    totalMembers: 0,
    unlinkedAccounts: 0
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [selectedClanId]);

  async function fetchData() {
    setLoading(true);
    try {
      // 1. Fetch Stats
      const { data: escalationSetting } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'warning_escalation_days')
        .single();
      
      const escalationDays = escalationSetting?.value || 3;
      const escalationDate = new Date();
      escalationDate.setDate(escalationDate.getDate() - escalationDays);

      // Person count (needs to be joined with player_accounts if filtering by clan)
      const personQuery = supabase.from('persons').select('id', { count: 'exact', head: true });
      if (selectedClanId !== 'all') {
          // This is tricky with exact count on persons. Let's count distinct person_id in player_accounts
          const { count } = await supabase
            .from('player_accounts')
            .select('person_id', { count: 'exact', head: true })
            .eq('clan_id', selectedClanId)
            .not('person_id', 'is', null);
          setStats(s => ({ ...s, totalMembers: count || 0 }));
      } else {
          const { count } = await personQuery;
          setStats(s => ({ ...s, totalMembers: count || 0 }));
      }

      // Unlinked accounts
      let unlinkedQuery = supabase
        .from('player_accounts')
        .select('*', { count: 'exact', head: true })
        .is('person_id', null)
        .eq('status', 'active');
      if (selectedClanId !== 'all') unlinkedQuery = unlinkedQuery.eq('clan_id', selectedClanId);
      const { count: unlinkedCount } = await unlinkedQuery;

      // Pending warnings
      let pendingQuery = supabase
        .from('warnings')
        .select('*, player_account:player_accounts!inner(*)', { count: 'exact', head: true })
        .eq('acknowledged', false);
      if (selectedClanId !== 'all') pendingQuery = pendingQuery.eq('player_account.clan_id', selectedClanId);
      const { count: pendingCount } = await pendingQuery;

      // High warnings
      let highQuery = supabase
        .from('warnings')
        .select('*, player_account:player_accounts!inner(*)', { count: 'exact', head: true })
        .eq('acknowledged', false)
        .lt('logged_at', escalationDate.toISOString());
      if (selectedClanId !== 'all') highQuery = highQuery.eq('player_account.clan_id', selectedClanId);
      const { count: highCount } = await highQuery;

      setStats(prev => ({
        ...prev,
        highWarnings: highCount || 0,
        pendingAcknowledge: pendingCount || 0,
        unlinkedAccounts: unlinkedCount || 0
      }));

    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
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
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <div style={{ padding: 'var(--space-sm)', background: 'rgba(239, 68, 68, 0.1)', borderRadius: 'var(--radius-md)' }}>
              <AlertTriangle color="var(--color-danger)" size={24} />
            </div>
            <span className="text-muted" style={{ fontWeight: '600', textTransform: 'uppercase', fontSize: '0.75rem' }}>High Warnings</span>
          </div>
          <h2 style={{ fontSize: '2.5rem', margin: 0 }}>{loading ? '...' : stats.highWarnings}</h2>
          <p className="text-danger" style={{ fontSize: '0.75rem', marginTop: 'var(--space-sm)' }}>Action required today</p>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <div style={{ padding: 'var(--space-sm)', background: 'rgba(245, 158, 11, 0.1)', borderRadius: 'var(--radius-md)' }}>
              <Clock color="var(--color-warning)" size={24} />
            </div>
            <span className="text-muted" style={{ fontWeight: '600', textTransform: 'uppercase', fontSize: '0.75rem' }}>Pending Acknowledge</span>
          </div>
          <h2 style={{ fontSize: '2.5rem', margin: 0 }}>{loading ? '...' : stats.pendingAcknowledge}</h2>
          <p className="text-warning" style={{ fontSize: '0.75rem', marginTop: 'var(--space-sm)' }}>Needs leadership review</p>
        </div>

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
            <div style={{ padding: 'var(--space-sm)', background: 'rgba(34, 197, 94, 0.1)', borderRadius: 'var(--radius-md)' }}>
              <Users color="var(--color-cta)" size={24} />
            </div>
            <span className="text-muted" style={{ fontWeight: '600', textTransform: 'uppercase', fontSize: '0.75rem' }}>Total Members</span>
          </div>
          <h2 style={{ fontSize: '2.5rem', margin: 0 }}>{loading ? '...' : stats.totalMembers}</h2>
          <p className="text-cta" style={{ fontSize: '0.75rem', marginTop: 'var(--space-sm)' }}>Registered in registry</p>
        </div>

        <div className="card">
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
