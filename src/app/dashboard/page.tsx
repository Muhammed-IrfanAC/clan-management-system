'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  AlertTriangle, 
  Users, 
  TrendingUp, 
  Clock, 
  RefreshCw,
  History,
  Shield,
  Sword,
  Tag
} from 'lucide-react';
import { useClan } from '@/lib/ClanContext';
import { Warning, LeadershipLog, Person, Rule, PlayerAccount, Clan } from '@/types/database';

type ExtendedWarning = Warning & {
  person: Person;
  rule: Rule | null;
  player_account: PlayerAccount;
};

type ExtendedLog = LeadershipLog & {
  clan: Clan | null;
  person: Person | null;
};

export default function DashboardPage() {
  const { selectedClanId } = useClan();
  const [stats, setStats] = useState({
    highWarnings: 0,
    pendingAcknowledge: 0,
    totalMembers: 0,
    unlinkedAccounts: 0
  });
  const [recentWarnings, setRecentWarnings] = useState<ExtendedWarning[]>([]);
  const [recentActivity, setRecentActivity] = useState<ExtendedLog[]>([]);
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
      let personQuery = supabase.from('persons').select('id', { count: 'exact', head: true });
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

      // 2. Fetch Recent Warnings (last 5)
      let warningsReq = supabase
        .from('warnings')
        .select(`
          *,
          person:persons (*),
          rule:rules (*),
          player_account:player_accounts!inner (*)
        `)
        .order('logged_at', { ascending: false })
        .limit(5);
      if (selectedClanId !== 'all') warningsReq = warningsReq.eq('player_account.clan_id', selectedClanId);
      const { data: warningsData } = await warningsReq;
      setRecentWarnings(warningsData as ExtendedWarning[] || []);

      // 3. Fetch Recent Activity (last 5)
      let activityReq = supabase
        .from('leadership_logs')
        .select(`
          *,
          clan:clans (*),
          person:persons (*)
        `)
        .order('logged_at', { ascending: false })
        .limit(5);
      if (selectedClanId !== 'all') activityReq = activityReq.eq('clan_id', selectedClanId);
      const { data: activityData } = await activityReq;
      setRecentActivity(activityData as ExtendedLog[] || []);

    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }

  const categoryIcons: any = {
    promotion: <Shield size={14} className="text-cta" />,
    demotion: <Shield size={14} className="text-danger" />,
    war: <Sword size={14} />,
    recruitment: <Users size={14} />,
    capital: <Tag size={14} />,
    general: <History size={14} />
  };

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-2xl)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Commander Overview</h1>
          <p className="text-muted">
            {selectedClanId === 'all' ? 'Real-time status of your clan family.' : `Monitoring activity for ${recentActivity[0]?.clan?.display_name || 'selected clan'}.`}
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

      {/* Main Grid Content */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '2fr 1fr', 
        gap: 'var(--space-lg)' 
      }}>
        <div className="card" style={{ minHeight: '400px' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 'var(--space-lg)' }}>Recent Warnings</h3>
          
          {recentWarnings.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '300px', gap: 'var(--space-md)' }}>
               <p className="text-muted">No warnings recorded recently.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {recentWarnings.map(w => (
                <div key={w.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--color-warning)' }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                     <span style={{ fontWeight: '700' }}>{w.person.display_name}</span>
                     <span className="text-muted" style={{ fontSize: '0.7rem' }}>{new Date(w.logged_at).toLocaleDateString()}</span>
                   </div>
                   <p className="text-muted" style={{ fontSize: '0.8rem', margin: 0 }}>{w.rule?.name || 'General Violation'}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card" style={{ minHeight: '400px' }}>
          <h3 style={{ fontSize: '1rem', marginBottom: 'var(--space-lg)' }}>Activity Feed</h3>
          
          {recentActivity.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)', marginTop: 'var(--space-lg)' }}>
               <p className="text-muted" style={{ fontSize: '0.85rem' }}>No recent leadership activity.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
              {recentActivity.map(log => (
                <div key={log.id} style={{ display: 'flex', gap: 'var(--space-md)', paddingBottom: 'var(--space-md)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <div style={{ marginTop: '4px' }}>{categoryIcons[log.category]}</div>
                  <div>
                    <p style={{ fontSize: '0.85rem', margin: 0, lineHeight: '1.4' }}>{log.description}</p>
                    <p className="text-muted" style={{ fontSize: '0.7rem', marginTop: '4px' }}>{new Date(log.logged_at).toLocaleTimeString()}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
