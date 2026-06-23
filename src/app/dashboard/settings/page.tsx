'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Settings, 
  Shield, 
  Users, 
  Plus, 
  Save,
  Trash2,
  RefreshCw,
  X,
  AlertCircle
} from 'lucide-react';
import { Clan, Rule, Setting, PlayerAccount } from '@/types/database';
import ConfirmationModal from '@/components/ui/ConfirmationModal';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'general' | 'clans' | 'rules' | 'leaders'>('general');
  const [loading, setLoading] = useState(true);
  
  // Data state
  const [appSettings, setAppSettings] = useState<Setting[]>([]);
  const [clans, setClans] = useState<Clan[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [leaders, setLeaders] = useState<PlayerAccount[]>([]);

  // Modal states
  const [showAddClan, setShowAddClan] = useState(false);
  const [showAddRule, setShowAddRule] = useState(false);
  const [showAddLeader, setShowAddLeader] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    variant: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    variant: 'danger'
  });

  // Form states
  const [newClan, setNewClan] = useState({ tag: '', name: '', type: 'main' });
  const [newRule, setNewRule] = useState({ name: '', description: '', guidance: '' });
  const [leaderTag, setLeaderTag] = useState('');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    try {
      const { data: s } = await supabase.from('settings').select('*');
      setAppSettings(s || []);
      const { data: c } = await supabase.from('clans').select('*').order('display_order');
      setClans(c || []);
      const { data: r } = await supabase.from('rules').select('*');
      setRules(r || []);
      const { data: l } = await supabase.from('player_accounts')
        .select('*')
        .in('db_role', ['super_admin', 'leader', 'co_leader'])
        .eq('access_enabled', true);
      setLeaders(l || []);
    } catch (err) {
      console.error('Error fetching settings:', err);
    } finally {
      setLoading(false);
    }
  }

  async function updateSetting(key: string, value: any) {
    try {
      const { error } = await supabase.from('settings').update({ value }).eq('key', key);
      if (error) throw error;
      fetchData();
    } catch (err) { alert('Error updating setting'); }
  }

  const handleAddClan = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/clans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          clan_tag: newClan.tag.toUpperCase().startsWith('#') ? newClan.tag.toUpperCase() : `#${newClan.tag.toUpperCase()}`, 
          display_name: newClan.name, 
          clan_type: newClan.type, 
          display_order: clans.length 
        }),
      });
      if (res.ok) {
        setShowAddClan(false);
        setNewClan({ tag: '', name: '', type: 'main' });
        fetchData();
      }
    } catch (e) { alert('Error adding clan'); }
  };

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: newRule.name, 
          description: newRule.description, 
          logging_guidance: newRule.guidance 
        }),
      });
      if (res.ok) {
        setShowAddRule(false);
        setNewRule({ name: '', description: '', guidance: '' });
        fetchData();
      }
    } catch (e) { alert('Error adding rule'); }
  };

  const handleAddLeader = async (e: React.FormEvent) => {
    e.preventDefault();
    const tag = leaderTag.toUpperCase().startsWith('#') ? leaderTag.toUpperCase() : `#${leaderTag.toUpperCase()}`;
    try {
      // First check if account exists
      const { data: existing } = await supabase.from('player_accounts').select('*').eq('player_tag', tag).single();
      
      if (!existing) {
        alert('Account not found in registry. User must login once or be synced first.');
        return;
      }

      const res = await fetch(`/api/leaders/${encodeURIComponent(tag)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_enabled: true, db_role: 'leader' }),
      });
      
      if (res.ok) {
        setShowAddLeader(false);
        setLeaderTag('');
        fetchData();
      }
    } catch (e) { alert('Error adding leader'); }
  };

  const triggerConfirm = (title: string, message: string, onConfirm: () => void, variant: 'danger' | 'warning' | 'info' = 'danger') => {
    setConfirmConfig({ isOpen: true, title, message, onConfirm, variant });
  };

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-2xl)' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Command Center</h1>
        <p className="text-muted">Global configuration and leadership management.</p>
      </div>

      <div className="settings-grid">
        {/* Tabs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
           {['general', 'clans', 'rules', 'leaders'].map((tab: any) => (
             <button 
               key={tab}
               onClick={() => setActiveTab(tab)}
               className={`btn ${activeTab === tab ? 'btn-primary' : 'btn-outline'}`}
               style={{ justifyContent: 'flex-start', border: activeTab === tab ? '' : 'none' }}
             >
               {tab === 'general' && <Settings size={18} />}
               {tab === 'clans' && <RefreshCw size={18} />}
               {tab === 'rules' && <Shield size={18} />}
               {tab === 'leaders' && <Users size={18} />}
               <span style={{ marginLeft: '10px', textTransform: 'capitalize' }}>{tab}</span>
             </button>
           ))}
        </div>

        {/* Content */}
        <div className="card" style={{ minHeight: '600px' }}>
           {activeTab === 'general' && (
             <div>
                <h3>System Settings</h3>
                <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: 'var(--space-xl)' }}>Configure automated behaviors and system defaults.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
                  {appSettings.map(s => (
                    <div key={s.key} className="setting-row">
                      <div>
                        <p style={{ fontWeight: '700', margin: 0 }}>{s.key.replace(/_/g, ' ').toUpperCase()}</p>
                        <p className="text-muted" style={{ fontSize: '0.8rem', margin: 0 }}>{s.description}</p>
                      </div>
                      <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
                         {typeof s.value === 'boolean' ? (
                           <button onClick={() => updateSetting(s.key, !s.value)} className={`btn ${s.value ? 'btn-primary' : 'btn-outline'}`} style={{ fontSize: '0.75rem', padding: 'var(--space-xs) var(--space-md)' }}>
                             {s.value ? 'ENABLED' : 'DISABLED'}
                           </button>
                         ) : (
                           <input type="number" className="input" style={{ width: '80px', textAlign: 'center' }} value={s.value} onChange={(e) => updateSetting(s.key, parseInt(e.target.value))} />
                         )}
                      </div>
                    </div>
                  ))}
                </div>
             </div>
           )}

           {activeTab === 'clans' && (
             <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
                  <h3>Clan Family</h3>
                  <button onClick={() => setShowAddClan(true)} className="btn btn-primary" style={{ fontSize: '0.75rem' }}><Plus size={16} /> Add Clan</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {clans.map(c => (
                    <div key={c.id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <div><span style={{ fontWeight: '700' }}>{c.display_name}</span><span className="text-muted" style={{ marginLeft: 'var(--space-md)' }}>{c.clan_tag}</span></div>
                       <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
                          <span style={{ fontSize: '0.7rem', color: 'var(--color-muted)', textTransform: 'uppercase' }}>{c.clan_type}</span>
                          <button onClick={() => triggerConfirm('Remove Clan', `Permanently remove ${c.display_name}? Accounts will remain but lose clan affiliation.`, async () => {
                            await fetch(`/api/clans/${c.id}`, { method: 'DELETE' });
                            fetchData();
                            setConfirmConfig({ ...confirmConfig, isOpen: false });
                          })} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}><Trash2 size={16} /></button>
                       </div>
                    </div>
                  ))}
                </div>
             </div>
           )}

           {activeTab === 'rules' && (
             <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
                  <h3>Rules Library</h3>
                  <button onClick={() => setShowAddRule(true)} className="btn btn-primary" style={{ fontSize: '0.75rem' }}><Plus size={16} /> Add Rule</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {rules.map(r => (
                    <div key={r.id} className="card" style={{ background: 'rgba(255,255,255,0.02)', cursor: 'default' }}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-sm)' }}>
                         <h4 style={{ margin: 0 }}>{r.name}</h4>
                         <button onClick={() => triggerConfirm('Delete Rule', `Delete rule "${r.name}"? Warnings using this rule will remain but the rule reference will be lost.`, async () => {
                            await fetch(`/api/rules/${r.id}`, { method: 'DELETE' });
                            fetchData();
                            setConfirmConfig({ ...confirmConfig, isOpen: false });
                         })} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}><Trash2 size={16} /></button>
                       </div>
                       <p className="text-muted" style={{ fontSize: '0.85rem' }}>{r.description}</p>
                    </div>
                  ))}
                </div>
             </div>
           )}

           {activeTab === 'leaders' && (
             <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
                  <h3>Authorized Leadership</h3>
                  <button onClick={() => setShowAddLeader(true)} className="btn btn-primary" style={{ fontSize: '0.75rem' }}><Plus size={16} /> Add Leader</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {leaders.map(l => (
                    <div key={l.player_tag} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                         <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: l.access_enabled ? 'var(--color-cta)' : 'var(--color-muted)' }}></div>
                         <div><p style={{ fontWeight: '700', margin: 0 }}>{l.in_game_name}</p><p className="text-muted" style={{ fontSize: '0.7rem', margin: 0 }}>{l.player_tag} • {l.db_role.toUpperCase()}</p></div>
                       </div>
                       {l.db_role !== 'super_admin' && (
                         <button onClick={() => triggerConfirm('Revoke Access', `Instantly block ${l.in_game_name} from the dashboard? They will remain in registry as a regular member.`, async () => {
                            await fetch(`/api/leaders/${encodeURIComponent(l.player_tag)}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ access_enabled: false }),
                            });
                            fetchData();
                            setConfirmConfig({ ...confirmConfig, isOpen: false });
                         }, 'warning')} className="btn btn-outline" style={{ border: 'none', color: 'var(--color-danger)', fontSize: '0.7rem' }}>REVOKE ACCESS</button>
                       )}
                    </div>
                  ))}
                </div>
             </div>
           )}
        </div>
      </div>

      {/* Add Clan Modal */}
      {showAddClan && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Register New Clan</h2>
              <X onClick={() => setShowAddClan(false)} style={{ cursor: 'pointer' }} />
            </div>
            <form onSubmit={handleAddClan} style={{ padding: 'var(--space-lg)' }}>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                 <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Clan Tag</label>
                 <input className="input" placeholder="#29L..." value={newClan.tag} onChange={e => setNewClan({...newClan, tag: e.target.value})} required />
               </div>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                 <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Display Name</label>
                 <input className="input" placeholder="e.g. Main Clan" value={newClan.name} onChange={e => setNewClan({...newClan, name: e.target.value})} required />
               </div>
               <div style={{ marginBottom: 'var(--space-lg)' }}>
                 <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Role</label>
                 <select className="input" value={newClan.type} onChange={e => setNewClan({...newClan, type: e.target.value})}>
                   <option value="main">Main Clan</option>
                   <option value="feeder">Feeder Clan</option>
                 </select>
               </div>
               <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Initialize Clan</button>
            </form>
          </div>
        </div>
      )}

      {/* Add Rule Modal */}
      {showAddRule && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Create System Rule</h2>
              <X onClick={() => setShowAddRule(false)} style={{ cursor: 'pointer' }} />
            </div>
            <form onSubmit={handleAddRule} style={{ padding: 'var(--space-lg)' }}>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                 <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Rule Name</label>
                 <input className="input" placeholder="e.g. Miss War Attack" value={newRule.name} onChange={e => setNewRule({...newRule, name: e.target.value})} required />
               </div>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                 <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Description</label>
                 <textarea className="input" rows={3} value={newRule.description} onChange={e => setNewRule({...newRule, description: e.target.value})} required />
               </div>
               <div style={{ marginBottom: 'var(--space-lg)' }}>
                 <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Logging Guidance (Tips for leaders)</label>
                 <input className="input" value={newRule.guidance} onChange={e => setNewRule({...newRule, guidance: e.target.value})} />
               </div>
               <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Save Rule</button>
            </form>
          </div>
        </div>
      )}

      {/* Add Leader Modal */}
      {showAddLeader && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Authorize Leadership</h2>
              <X onClick={() => setShowAddLeader(false)} style={{ cursor: 'pointer' }} />
            </div>
            <form onSubmit={handleAddLeader} style={{ padding: 'var(--space-lg)' }}>
               <div style={{ display: 'flex', gap: 'var(--space-md)', padding: '12px', background: 'rgba(245, 158, 11, 0.05)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-lg)', border: '1px solid rgba(245, 158, 11, 0.1)' }}>
                 <AlertCircle size={18} className="text-warning" />
                 <p style={{ fontSize: '0.75rem', margin: 0 }}>The user must already exist in the Member Registry before you can grant them dashboard access.</p>
               </div>
               <div style={{ marginBottom: 'var(--space-lg)' }}>
                 <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Player Tag</label>
                 <input className="input" placeholder="#Y2Q..." value={leaderTag} onChange={e => setLeaderTag(e.target.value)} required />
               </div>
               <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Grant Dashboard Access</button>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal 
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig({ ...confirmConfig, isOpen: false })}
        onConfirm={confirmConfig.onConfirm}
        title={confirmConfig.title}
        message={confirmConfig.message}
        variant={confirmConfig.variant}
      />
    </div>
  );
}
