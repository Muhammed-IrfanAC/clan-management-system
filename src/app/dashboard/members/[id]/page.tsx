'use client';

import { useState, useEffect, use } from 'react';
import { supabase } from '@/lib/supabase';
import {
  User,
  Shield,
  AlertTriangle,
  History,
  ChevronLeft,
  Calendar,
  ExternalLink,
  Trash2,
  Link as LinkIcon,
  Baby,
  Clock,
  ArrowUpCircle
} from 'lucide-react';
import Link from 'next/link';
import { Person, PlayerAccount, Warning, LeadershipLog, Clan, Rule } from '@/types/database';
import { babyDaysLeft } from '@/lib/babies';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useRouter } from 'next/navigation';

type FullPerson = Person & {
  player_accounts: (PlayerAccount & { clan: Clan })[];
  warnings: (Warning & { rule: Rule | null, player_account: PlayerAccount })[];
  activity_logs: LeadershipLog[];
};

export default function PersonProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [person, setPerson] = useState<FullPerson | null>(null);
  const [loggerNames, setLoggerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [babyTrialDays, setBabyTrialDays] = useState(4);
  const [promoting, setPromoting] = useState(false);
  
  // Modal state
  const [confirmConfig, setConfirmConfig] = useState({
    isOpen: false,
    type: 'player' as 'player' | 'person',
    tag: '',
    title: '',
    message: ''
  });

  useEffect(() => {
    fetchPerson();
  }, [id]);

  async function fetchPerson() {
    setLoading(true);
    try {
      const { data: pData, error: pError } = await supabase
        .from('persons')
        .select(`
          *,
          player_accounts (
            *,
            clan:clans (*)
          ),
          warnings (
            *,
            rule:rules (*),
            player_account:player_accounts (*)
          ),
          activity_logs:leadership_logs (*)
        `)
        .eq('id', id)
        .single();

      if (pError) throw pError;
      setPerson(pData as FullPerson);

      const { data: trialSetting } = await supabase.from('settings').select('value').eq('key', 'baby_trial_days').single();
      const parsedTrial = parseInt(String(trialSetting?.value ?? ''), 10);
      if (Number.isFinite(parsedTrial) && parsedTrial > 0) setBabyTrialDays(parsedTrial);

      // Resolve each warning's logged_by (a player_tag) to the logger's person name.
      const loggerTags = Array.from(new Set(((pData as FullPerson)?.warnings || []).map(w => w.logged_by).filter(Boolean)));
      if (loggerTags.length) {
        const { data: loggers } = await supabase
          .from('player_accounts')
          .select('player_tag, in_game_name, person:persons (display_name)')
          .in('player_tag', loggerTags);
        const map: Record<string, string> = {};
        for (const l of (loggers as any[]) || []) {
          map[l.player_tag] = l.person?.display_name || l.in_game_name || l.player_tag;
        }
        setLoggerNames(map);
      }
    } catch (err) {
      console.error('Error fetching person:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handlePromote() {
    setPromoting(true);
    try {
      const res = await fetch(`/api/persons/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'promote' }),
      });
      if (!res.ok) throw new Error('Failed to promote');
      fetchPerson();
    } catch (err) {
      alert('Error promoting member');
    } finally {
      setPromoting(false);
    }
  }

  async function handleRemovePlayer() {
    try {
      const res = await fetch(`/api/players/${encodeURIComponent(confirmConfig.tag)}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmConfig({ ...confirmConfig, isOpen: false });
        if (person?.player_accounts.length === 1) {
            router.push('/dashboard/members');
        } else {
            fetchPerson();
        }
      }
    } catch (err) { alert('Error removing player'); }
  }

  async function handleUnlinkPlayer(tag: string) {
      try {
          const { error } = await supabase.from('player_accounts').update({ person_id: null }).eq('player_tag', tag);
          if (error) throw error;
          if (person?.player_accounts.length === 1) {
              await supabase.from('persons').delete().eq('id', id);
              router.push('/dashboard/members');
          } else {
              fetchPerson();
          }
      } catch (err) { alert('Error unlinking player'); }
  }

  if (loading) return <p className="text-muted">Loading profile...</p>;
  if (!person) return <p className="text-danger">Person not found.</p>;

  return (
    <div>
      <Link href="/dashboard/members" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--color-muted)', marginBottom: 'var(--space-lg)', fontSize: '0.9rem' }}>
        <ChevronLeft size={16} /> Back to Registry
      </Link>

      <div className="profile-grid">
        {/* Left Column: Person Info & Accounts */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
              <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <User size={32} color="var(--color-cta)" />
              </div>
              <div>
                <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{person.display_name}</h1>
                <p className="text-muted" style={{ fontSize: '0.8rem' }}>Member since {new Date(person.created_at).toLocaleDateString()}</p>
              </div>
            </div>

            {person.is_baby && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-md)', padding: 'var(--space-md)', marginBottom: 'var(--space-lg)', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.25)', borderRadius: 'var(--radius-md)' }}>
                <span className="baby-badge">
                  <Baby size={12} /> BABY
                  <span className="baby-badge-count">
                    <Clock size={11} /> {(() => { const d = babyDaysLeft(person.baby_started_at, babyTrialDays); return d > 0 ? `${d}d left` : 'trial ended'; })()}
                  </span>
                </span>
                <button onClick={handlePromote} disabled={promoting} className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
                  <ArrowUpCircle size={16} /> {promoting ? 'Promoting...' : 'Promote to Member'}
                </button>
              </div>
            )}

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 'var(--space-lg)' }}>
               <h3 style={{ fontSize: '0.9rem', marginBottom: 'var(--space-md)' }}>Linked Accounts</h3>
               <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                 {person.player_accounts.map(acc => (
                   <div key={acc.player_tag} style={{ 
                     padding: 'var(--space-md)', 
                     background: 'rgba(255,255,255,0.02)', 
                     borderRadius: 'var(--radius-md)',
                     border: '1px solid rgba(255,255,255,0.05)'
                   }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                        <span style={{ fontWeight: '700' }}>{acc.in_game_name}</span>
                        <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                            <button onClick={() => handleUnlinkPlayer(acc.player_tag)} style={{ background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }} title="Unlink Account"><LinkIcon size={14} /></button>
                            <button onClick={() => setConfirmConfig({ isOpen: true, type: 'player', tag: acc.player_tag, title: 'Remove Account', message: `Permanently delete ${acc.in_game_name} from registry?` })} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }} title="Delete Account"><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }} className="text-muted">
                        <span>{acc.player_tag} • TH{acc.th_level}</span>
                        <span style={{ fontSize: '0.65rem', padding: '1px 5px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px' }}>{acc.clan.display_name}</span>
                      </div>
                   </div>
                 ))}
               </div>
            </div>
          </div>
        </div>

        {/* Right Column: History */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
           {/* Warnings History */}
           <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                <AlertTriangle size={20} className="text-warning" />
                <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Enforcement History</h2>
              </div>
              {person.warnings.length === 0 ? (
                <p className="text-muted" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>No warnings on record.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {person.warnings.map(w => (
                    <div key={w.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', borderLeft: `3px solid ${w.acknowledged ? 'var(--color-cta)' : 'var(--color-warning)'}` }}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                         <span style={{ fontWeight: '600' }}>{w.rule?.name || 'General Warning'}</span>
                         <span style={{ fontSize: '0.7rem' }} className="text-muted">{new Date(w.logged_at).toLocaleDateString()}</span>
                       </div>
                       <p style={{ fontSize: '0.85rem', margin: '8px 0' }}>{w.description}</p>
                       <div style={{ fontSize: '0.7rem' }} className="text-muted">Logged by {loggerNames[w.logged_by] || w.logged_by} on account {w.player_account.in_game_name}</div>
                    </div>
                  ))}
                </div>
              )}
           </div>

           {/* Activity History */}
           <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
                <History size={20} color="var(--color-cta)" />
                <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Leadership Activity</h2>
              </div>
              {person.activity_logs.length === 0 ? (
                <p className="text-muted" style={{ padding: 'var(--space-lg)', textAlign: 'center' }}>No related activity logs.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {person.activity_logs.map(log => (
                    <div key={log.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)' }}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)' }}>
                         <span style={{ fontWeight: '600', textTransform: 'uppercase', fontSize: '0.7rem', color: 'var(--color-cta)' }}>{log.category}</span>
                         <span style={{ fontSize: '0.7rem' }} className="text-muted">{new Date(log.logged_at).toLocaleDateString()}</span>
                       </div>
                       <p style={{ fontSize: '0.85rem', margin: '4px 0' }}>{log.description}</p>
                    </div>
                  ))}
                </div>
              )}
           </div>
        </div>
      </div>

      <ConfirmationModal 
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig({ ...confirmConfig, isOpen: false })}
        onConfirm={handleRemovePlayer}
        title={confirmConfig.title}
        message={confirmConfig.message}
      />
    </div>
  );
}
