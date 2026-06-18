'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  AlertTriangle, 
  CheckCircle, 
  Plus, 
  Search, 
  Filter,
  Info,
  Trash2,
  X,
  ChevronDown
} from 'lucide-react';
import { Warning, Person, PlayerAccount, Rule } from '@/types/database';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useClan } from '@/lib/ClanContext';

type ExtendedWarning = Warning & {
  person: Person;
  rule: Rule | null;
  player_account: PlayerAccount;
};

export default function WarningsPage() {
  const { selectedClanId } = useClan();
  const [warnings, setWarnings] = useState<ExtendedWarning[]>([]);
  const [loggerNames, setLoggerNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [escalationDays, setEscalationDays] = useState(3);
  const [showLogModal, setShowLogModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'high' | 'pending' | 'acknowledged'>('all');
  
  // Confirmation Modal
  const [confirmConfig, setConfirmConfig] = useState({
    isOpen: false,
    id: '',
    title: '',
    message: ''
  });

  // Log Modal State
  const [persons, setPersons] = useState<Person[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<string>('');
  const [personAccounts, setPersonAccounts] = useState<PlayerAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [rules, setRules] = useState<Rule[]>([]);
  const [selectedRule, setSelectedRule] = useState<string>('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    fetchData();
  }, [selectedClanId]);

  async function fetchData() {
    setLoading(true);
    try {
      const { data: settings } = await supabase.from('settings').select('*').eq('key', 'warning_escalation_days').single();
      setEscalationDays(settings?.value || 3);

      let req = supabase
        .from('warnings')
        .select(`
          *,
          person:persons (*),
          rule:rules (*),
          player_account:player_accounts!inner (*)
        `)
        .order('logged_at', { ascending: false });
      
      if (selectedClanId !== 'all') req = req.eq('player_account.clan_id', selectedClanId);
      
      const { data: warningsData } = await req;
      setWarnings(warningsData as ExtendedWarning[] || []);

      // Resolve each warning's logged_by (a player_tag) to the logger's person name.
      // warnings.logged_by has no FK to player_accounts, so we resolve it with a
      // separate lookup: player_tag -> person.display_name (falling back to in_game_name).
      const loggerTags = Array.from(new Set((warningsData || []).map((w: any) => w.logged_by).filter(Boolean)));
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
      } else {
        setLoggerNames({});
      }

      const { data: rulesData } = await supabase.from('rules').select('*');
      setRules(rulesData || []);

      const { data: personsData } = await supabase.from('persons').select('*').order('display_name');
      setPersons(personsData || []);

    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (selectedPerson) {
      supabase.from('player_accounts').select('*').eq('person_id', selectedPerson)
        .then(({ data }) => setPersonAccounts(data || []));
    } else {
      setPersonAccounts([]);
    }
  }, [selectedPerson]);

  async function handleAcknowledge(id: string, current: boolean) {
    try {
      const res = await fetch(`/api/warnings/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acknowledged: !current }),
      });
      if (res.ok) fetchData();
    } catch (err) { alert('Error updating warning'); }
  }

  async function handleLogWarning(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await fetch('/api/warnings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personId: selectedPerson,
          playerTag: selectedAccount,
          ruleId: selectedRule || null,
          description
        }),
      });

      if (res.ok) {
        setShowLogModal(false);
        setSelectedPerson('');
        setSelectedAccount('');
        setSelectedRule('');
        setDescription('');
        fetchData();
      }
    } catch (err) { alert('Error logging warning'); }
  }

  async function deleteWarning() {
    try {
      const res = await fetch(`/api/warnings/${confirmConfig.id}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmConfig({ ...confirmConfig, isOpen: false });
        fetchData();
      }
    } catch (err) { alert('Error deleting warning'); }
  }

  const isHigh = (w: ExtendedWarning) => {
    if (w.acknowledged) return false;
    const loggedDate = new Date(w.logged_at);
    const escalationDate = new Date();
    escalationDate.setDate(escalationDate.getDate() - escalationDays);
    return loggedDate < escalationDate;
  };

  const filteredWarnings = warnings.filter(w => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'high') return isHigh(w);
    if (filterStatus === 'pending') return !w.acknowledged && !isHigh(w);
    if (filterStatus === 'acknowledged') return w.acknowledged;
    return true;
  });

  const selectedRuleData = rules.find(r => r.id === selectedRule);

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-2xl)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Warning Log</h1>
          <p className="text-muted">Track and escalate rule violations across the clan family.</p>
        </div>
        
        <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
           <select className="input" style={{ width: '180px' }} value={filterStatus} onChange={(e: any) => setFilterStatus(e.target.value)}>
             <option value="all">All Statuses</option>
             <option value="high">High Escalation</option>
             <option value="pending">Pending</option>
             <option value="acknowledged">Acknowledged</option>
           </select>
           <button className="btn btn-primary" onClick={() => setShowLogModal(true)}>
             <Plus size={20} /> Log New Warning
           </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {loading ? (
          <p className="text-muted">Loading warnings...</p>
        ) : filteredWarnings.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
            <p className="text-muted">No warnings found for this filter.</p>
          </div>
        ) : (
          filteredWarnings.map(w => {
            const high = isHigh(w);
            return (
              <div key={w.id} className="card" style={{ 
                borderLeft: high ? '4px solid var(--color-danger)' : w.acknowledged ? '4px solid var(--color-cta)' : '4px solid var(--color-warning)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-xs)' }}>
                      <h3 style={{ margin: 0 }}>{w.person.display_name}</h3>
                      {high && <span style={{ fontSize: '0.65rem', padding: '2px 8px', background: 'var(--color-danger)', color: '#fff', borderRadius: '10px', fontWeight: '700' }}>HIGH ESCALATION</span>}
                      {w.acknowledged && <span style={{ fontSize: '0.65rem', padding: '2px 8px', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-cta)', borderRadius: '10px', fontWeight: '700' }}>ACKNOWLEDGED</span>}
                    </div>
                    <p style={{ fontSize: '0.9rem', marginBottom: 'var(--space-sm)' }}><span className="text-muted">Rule: </span><span style={{ fontWeight: '600' }}>{w.rule?.name || 'General Violation'}</span></p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text)', marginBottom: 'var(--space-md)', lineHeight: '1.5' }}>{w.description}</p>
                    <div style={{ display: 'flex', gap: 'var(--space-xl)', fontSize: '0.75rem' }} className="text-muted">
                       <span>Account: <strong>{w.player_account.in_game_name} ({w.player_account_tag})</strong></span>
                       <span>Logged by: <strong>{loggerNames[w.logged_by] || w.logged_by}</strong></span>
                       <span>When: <strong>{new Date(w.logged_at).toLocaleString()}</strong></span>
                    </div>
                  </div>
                  <div style={{ marginLeft: 'var(--space-xl)', display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
                    <button className={`btn ${w.acknowledged ? 'btn-outline' : 'btn-primary'}`} style={{ border: w.acknowledged ? '1px solid rgba(255,255,255,0.1)' : '', color: w.acknowledged ? 'var(--color-muted)' : '', padding: '0.5rem 1rem', fontSize: '0.75rem' }} onClick={() => handleAcknowledge(w.id, w.acknowledged)}>
                      {w.acknowledged ? <CheckCircle size={16} /> : 'Acknowledge'}
                    </button>
                    <button className="btn btn-outline" style={{ border: 'none', color: 'var(--color-danger)', padding: '0.5rem 1rem', fontSize: '0.75rem' }} onClick={() => setConfirmConfig({ isOpen: true, id: w.id, title: 'Delete Warning', message: `Permanently remove warning for ${w.person.display_name}? This cannot be undone.` })}>
                      <Trash2 size={16} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Log Warning Modal */}
      {showLogModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Log Rule Violation</h2>
              <X onClick={() => setShowLogModal(false)} style={{ cursor: 'pointer' }} />
            </div>
            <form onSubmit={handleLogWarning} style={{ padding: 'var(--space-lg)' }}>
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                  <div>
                    <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Person</label>
                    <select className="input" value={selectedPerson} onChange={(e) => setSelectedPerson(e.target.value)} required>
                      <option value="">Select Person...</option>
                      {persons.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Account</label>
                    <select className="input" value={selectedAccount} onChange={(e) => setSelectedAccount(e.target.value)} required disabled={!selectedPerson}>
                      <option value="">Select Account...</option>
                      {personAccounts.map(a => <option key={a.player_tag} value={a.player_tag}>{a.in_game_name} ({a.player_tag})</option>)}
                    </select>
                  </div>
               </div>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                  <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Rule</label>
                  <select className="input" value={selectedRule} onChange={(e) => setSelectedRule(e.target.value)}>
                    <option value="">No specific rule</option>
                    {rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
               </div>
               {selectedRuleData?.logging_guidance && (
                 <div style={{ padding: 'var(--space-md)', background: 'rgba(34, 197, 94, 0.05)', borderRadius: 'var(--radius-md)', marginBottom: 'var(--space-md)', border: '1px solid rgba(34, 197, 94, 0.2)', display: 'flex', gap: 'var(--space-md)', fontSize: '0.85rem' }}>
                   <Info className="text-cta" size={20} />
                   <div><p style={{ fontWeight: '700', margin: 0, color: 'var(--color-cta)' }}>Logging Guidance</p><p className="text-muted" style={{ margin: 0, marginTop: '4px' }}>{selectedRuleData.logging_guidance}</p></div>
                 </div>
               )}
               <div style={{ marginBottom: 'var(--space-lg)' }}>
                  <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Context</label>
                  <textarea className="input" rows={4} placeholder="Describe the violation..." value={description} onChange={(e) => setDescription(e.target.value)} required />
               </div>
               <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Finalize Log</button>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal 
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig({ ...confirmConfig, isOpen: false, id: '' })}
        onConfirm={deleteWarning}
        title={confirmConfig.title}
        message={confirmConfig.message}
      />
    </div>
  );
}
