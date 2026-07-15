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
import { Clan, Rule, Setting, AccessRole } from '@/types/database';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useCurrentUser } from '@/lib/useCurrentUser';
import { can, assignableRoles } from '@/lib/permissions';
import { DETECTOR_REGISTRY, detectorMeta, defaultConfigFor } from '@/lib/rules/registry';

// One access-holder row = a person (with access_role) plus a representative account for display.
type LeaderRow = {
  player_tag: string;
  display_name: string;
  person_id: string;
  access_role: AccessRole;
};

// A registry person eligible to be granted access (no access_role yet), with a representative
// account tag so the person-addressed leaders API can resolve them.
type PersonOption = {
  person_id: string;
  display_name: string;
  player_tag: string;
};

const ROLE_LABELS: Record<AccessRole, string> = {
  super_admin: 'Super Admin',
  leader: 'Leader',
  co_leader: 'Co-Leader',
};

export default function SettingsPage() {
  const { role } = useCurrentUser();
  // Admin tabs (general config, clan family, leadership) require the leader-management capability;
  // co-leaders get the Rules tab only. UI gating is cosmetic — the API routes enforce the rest.
  const canManage = can(role, 'leader.manage');
  const visibleTabs: Array<'general' | 'clans' | 'rules' | 'leaders'> = canManage
    ? ['general', 'clans', 'rules', 'leaders']
    : ['rules'];

  const [activeTab, setActiveTab] = useState<'general' | 'clans' | 'rules' | 'leaders'>('general');
  const [loading, setLoading] = useState(true);

  // Clamp the selected tab to what the role may see — co-leaders fall through to Rules — without
  // syncing state in an effect. Tab clicks set activeTab; this just guards the rendered value.
  const effectiveTab = visibleTabs.includes(activeTab) ? activeTab : visibleTabs[0];
  
  // Data state
  const [appSettings, setAppSettings] = useState<Setting[]>([]);
  const [clans, setClans] = useState<Clan[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [personOptions, setPersonOptions] = useState<PersonOption[]>([]);

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
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [personQuery, setPersonQuery] = useState('');
  const [newLeaderRole, setNewLeaderRole] = useState<AccessRole>('co_leader');

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
      // Access-holders = persons with a non-null access_role. A person may own several accounts, so
      // fetch their accounts, then collapse to one row per person (preferring the main account). We
      // display the PERSON (display_name); the account tag is just a representative handle for the API.
      const { data: accts } = await supabase.from('player_accounts')
        .select('player_tag, is_main_account, person_id, person:persons!inner(access_role, display_name)')
        .not('person.access_role', 'is', null);
      type AcctRow = {
        player_tag: string;
        is_main_account: boolean;
        person_id: string;
        person: { access_role: AccessRole; display_name: string } | null;
      };
      const byPerson = new Map<string, LeaderRow>();
      for (const a of (accts || []) as unknown as AcctRow[]) {
        if (!a.person_id || !a.person) continue;
        if (!byPerson.has(a.person_id) || a.is_main_account) {
          byPerson.set(a.person_id, {
            player_tag: a.player_tag,
            display_name: a.person.display_name,
            person_id: a.person_id,
            access_role: a.person.access_role,
          });
        }
      }
      setLeaders([...byPerson.values()]);

      // Candidate persons for the "Add Leader" picker: registry persons who do NOT yet hold access.
      // Same account→person collapse; each option carries a representative tag (prefer the main
      // account) so the person-addressed leaders API can resolve the grant.
      const { data: candAccts } = await supabase.from('player_accounts')
        .select('player_tag, is_main_account, person_id, person:persons!inner(access_role, display_name)')
        .is('person.access_role', null);
      const optByPerson = new Map<string, PersonOption>();
      for (const a of (candAccts || []) as unknown as AcctRow[]) {
        if (!a.person_id || !a.person) continue;
        if (!optByPerson.has(a.person_id) || a.is_main_account) {
          optByPerson.set(a.person_id, {
            person_id: a.person_id,
            display_name: a.person.display_name,
            player_tag: a.player_tag,
          });
        }
      }
      setPersonOptions(
        [...optByPerson.values()].sort((x, y) => x.display_name.localeCompare(y.display_name))
      );
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

  // Persist a rule's automation wiring (detector, enable flag, or config) via the rules API, which
  // validates the detector key. Mirrors updateSetting's save-then-refetch pattern.
  async function updateRuleAutomation(id: string, patch: Record<string, any>) {
    try {
      const res = await fetch(`/api/rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: 'Error updating automation' }));
        throw new Error(error);
      }
      fetchData();
    } catch (err: any) { alert(err?.message || 'Error updating automation'); }
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
    // Access is a person-level grant; we address the person via one of their account tags.
    const person = personOptions.find((p) => p.person_id === selectedPersonId);
    if (!person) {
      alert('Please select a member to grant access.');
      return;
    }
    try {
      const res = await fetch(`/api/leaders/${encodeURIComponent(person.player_tag)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_role: newLeaderRole }),
      });

      if (res.ok) {
        setShowAddLeader(false);
        setSelectedPersonId('');
        setPersonQuery('');
        setNewLeaderRole('co_leader');
        fetchData();
      } else {
        const { error } = await res.json().catch(() => ({ error: 'Error adding leader' }));
        alert(error || 'Error adding leader');
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
           {visibleTabs.map((tab: any) => (
             <button 
               key={tab}
               onClick={() => setActiveTab(tab)}
               className={`btn ${effectiveTab === tab ? 'btn-primary' : 'btn-outline'}`}
               style={{ justifyContent: 'flex-start', border: effectiveTab === tab ? '' : 'none' }}
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
           {effectiveTab === 'general' && (
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

           {effectiveTab === 'clans' && (
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

           {effectiveTab === 'rules' && (
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

                       {/* Automation: attach a built-in detector, toggle it, and tune its params. */}
                       <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                         <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
                           <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>Automation</label>
                           <select
                             className="input"
                             style={{ maxWidth: '240px' }}
                             value={r.automation_key ?? ''}
                             onChange={(e) => {
                               const key = e.target.value || null;
                               updateRuleAutomation(r.id, {
                                 automation_key: key,
                                 automation_enabled: false,
                                 automation_config: key ? defaultConfigFor(key) : {},
                               });
                             }}
                           >
                             <option value="">Manual (no automation)</option>
                             {DETECTOR_REGISTRY.map((d) => (
                               <option key={d.key} value={d.key}>{d.label}</option>
                             ))}
                           </select>
                           {r.automation_key && (
                             <button
                               onClick={() => updateRuleAutomation(r.id, { automation_enabled: !r.automation_enabled })}
                               className={`btn ${r.automation_enabled ? 'btn-primary' : 'btn-outline'}`}
                               style={{ fontSize: '0.7rem', padding: 'var(--space-xs) var(--space-md)' }}
                             >
                               {r.automation_enabled ? 'ENABLED' : 'DISABLED'}
                             </button>
                           )}
                         </div>
                         {r.automation_key && (() => {
                           const meta = detectorMeta(r.automation_key);
                           if (!meta) return <p className="text-warning" style={{ fontSize: '0.7rem', marginTop: 'var(--space-sm)' }}>Unknown detector &quot;{r.automation_key}&quot;.</p>;
                           return (
                             <>
                               <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: 'var(--space-sm)' }}>
                                 {meta.description}{meta.mode === 'review' ? ' Queues for leader review.' : ''}
                               </p>
                               {meta.configFields.length > 0 && (
                                 <div style={{ display: 'flex', gap: 'var(--space-lg)', flexWrap: 'wrap', marginTop: 'var(--space-sm)' }}>
                                   {meta.configFields.map((f) => (
                                     <div key={f.key}>
                                       <label className="text-muted" style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', display: 'block' }}>{f.label}</label>
                                       <input
                                         className="input"
                                         type={f.type}
                                         style={{ width: '130px' }}
                                         defaultValue={(r.automation_config?.[f.key] ?? f.default) as any}
                                         onBlur={(e) => {
                                           const val = f.type === 'number' ? Number(e.target.value) : e.target.value;
                                           updateRuleAutomation(r.id, { automation_config: { ...(r.automation_config || {}), [f.key]: val } });
                                         }}
                                       />
                                       {f.help && <p className="text-muted" style={{ fontSize: '0.6rem', margin: '2px 0 0' }}>{f.help}</p>}
                                     </div>
                                   ))}
                                 </div>
                               )}
                             </>
                           );
                         })()}
                       </div>
                    </div>
                  ))}
                </div>
             </div>
           )}

           {effectiveTab === 'leaders' && (
             <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-xl)' }}>
                  <h3>Authorized Leadership</h3>
                  <button onClick={() => setShowAddLeader(true)} className="btn btn-primary" style={{ fontSize: '0.75rem' }}><Plus size={16} /> Add Leader</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                  {leaders.map(l => (
                    <div key={l.person_id} style={{ padding: 'var(--space-md)', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                         <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-cta)' }}></div>
                         <div><p style={{ fontWeight: '700', margin: 0 }}>{l.display_name}</p><p className="text-muted" style={{ fontSize: '0.7rem', margin: 0 }}>{ROLE_LABELS[l.access_role].toUpperCase()} • all linked accounts</p></div>
                       </div>
                       {l.access_role !== 'super_admin' && (
                         <button onClick={() => triggerConfirm('Revoke Access', `Instantly block ${l.display_name} from the dashboard? Access is revoked for every account linked to them. They remain in the registry as a regular member.`, async () => {
                            await fetch(`/api/leaders/${encodeURIComponent(l.player_tag)}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ access_role: null }),
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
                 <p style={{ fontSize: '0.75rem', margin: 0 }}>Access is granted to a member — every account linked to them inherits it automatically.</p>
               </div>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                 <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Member</label>
                 <input
                   className="input"
                   placeholder="Search members…"
                   value={personQuery}
                   onChange={e => { setPersonQuery(e.target.value); setSelectedPersonId(''); }}
                   style={{ marginBottom: 'var(--space-sm)' }}
                 />
                 <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-md)' }}>
                   {personOptions
                     .filter(p => p.display_name.toLowerCase().includes(personQuery.trim().toLowerCase()))
                     .slice(0, 50)
                     .map(p => (
                       <div
                         key={p.person_id}
                         onClick={() => setSelectedPersonId(p.person_id)}
                         style={{
                           padding: 'var(--space-sm) var(--space-md)',
                           cursor: 'pointer',
                           fontSize: '0.85rem',
                           background: selectedPersonId === p.person_id ? 'rgba(34, 197, 94, 0.12)' : 'transparent',
                         }}
                       >
                         <span style={{ fontWeight: selectedPersonId === p.person_id ? 700 : 400 }}>{p.display_name}</span>
                         <span className="text-muted" style={{ marginLeft: 'var(--space-sm)', fontSize: '0.7rem' }}>{p.player_tag}</span>
                       </div>
                     ))}
                   {personOptions.filter(p => p.display_name.toLowerCase().includes(personQuery.trim().toLowerCase())).length === 0 && (
                     <div className="text-muted" style={{ padding: 'var(--space-md)', fontSize: '0.75rem' }}>No matching members without access.</div>
                   )}
                 </div>
               </div>
               <div style={{ marginBottom: 'var(--space-lg)' }}>
                 <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Role</label>
                 <select className="input" value={newLeaderRole} onChange={e => setNewLeaderRole(e.target.value as AccessRole)}>
                   {assignableRoles(role).map(r => (
                     <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                   ))}
                 </select>
                 <p className="text-muted" style={{ fontSize: '0.65rem', marginTop: 'var(--space-xs)' }}>{role === 'super_admin' ? 'The Super Admin role itself is set directly in the database.' : 'Only the Super Admin can grant the Leader role.'}</p>
               </div>
               <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={!selectedPersonId}>Grant Dashboard Access</button>
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
