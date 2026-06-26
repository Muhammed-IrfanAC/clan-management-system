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
  ChevronDown,
  Pencil,
  MessageSquare,
  Send
} from 'lucide-react';
import { Warning, Person, PlayerAccount, Rule, WarningNote } from '@/types/database';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useClan } from '@/lib/ClanContext';

type ExtendedWarning = Warning & {
  person: Person;
  rule: Rule | null;
  player_account: PlayerAccount;
  warning_notes: WarningNote[];
};

// Local "YYYY-MM-DD" for <input type="date">. Backdating only cares about the day;
// the time-of-day is defaulted (noon local) when the value is sent to the API.
function toLocalDate(iso: string): string {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// A date-only picker value -> ISO instant at local noon, so escalation math is stable
// and the day never shifts across timezones.
function dateToNoonIso(date: string): string {
  return new Date(`${date}T12:00`).toISOString();
}

export default function WarningsPage() {
  const { selectedClanId } = useClan();
  const [warnings, setWarnings] = useState<ExtendedWarning[]>([]);
  const [loggerNames, setLoggerNames] = useState<Record<string, string>>({});
  // player_tag -> person_id, so an author's alts are recognised for edit/delete controls.
  const [authorPersons, setAuthorPersons] = useState<Record<string, string | null>>({});
  const [currentUserTag, setCurrentUserTag] = useState<string | null>(null);
  const [myPersonId, setMyPersonId] = useState<string | null>(null);
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
  const [backdate, setBackdate] = useState(false);
  const [loggedAt, setLoggedAt] = useState('');

  // Edit Warning modal state
  const [editingWarning, setEditingWarning] = useState<ExtendedWarning | null>(null);
  const [editRule, setEditRule] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editLoggedAt, setEditLoggedAt] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Notes state
  const [openNotes, setOpenNotes] = useState<Record<string, boolean>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [postingNote, setPostingNote] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteDraft, setEditNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    fetchData();
  }, [selectedClanId]);

  // Honour a ?filter= shortcut from the dashboard stat cards (e.g. High Warnings / Pending).
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('filter');
    if (f === 'high' || f === 'pending' || f === 'acknowledged' || f === 'all') {
      setFilterStatus(f);
    }
  }, []);

  useEffect(() => {
    // Identify the acting leader (and their persona) so edit controls appear on warnings
    // and notes they authored — or that any of their alts authored (same person_id).
    fetch('/api/auth/me')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        setCurrentUserTag(d?.user?.player_tag ?? null);
        setMyPersonId(d?.user?.person_id ?? null);
      })
      .catch(() => {});
  }, []);

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
          player_account:player_accounts!inner (*),
          warning_notes (*)
        `)
        .order('logged_at', { ascending: false });

      if (selectedClanId !== 'all') req = req.eq('player_account.clan_id', selectedClanId);

      const { data: warningsData } = await req;
      setWarnings(warningsData as ExtendedWarning[] || []);

      // Resolve player_tags (warning loggers + note authors) to a display name and persona.
      // These tags have no FK to player_accounts, so we resolve them with a separate lookup:
      // player_tag -> person.display_name (falling back to in_game_name) and -> person_id.
      const loggerTags = Array.from(new Set((warningsData || []).flatMap((w: any) => [
        w.logged_by,
        ...((w.warning_notes || []).map((n: any) => n.author_tag)),
      ]).filter(Boolean)));
      if (loggerTags.length) {
        const { data: loggers } = await supabase
          .from('player_accounts')
          .select('player_tag, person_id, in_game_name, person:persons (display_name)')
          .in('player_tag', loggerTags);
        const map: Record<string, string> = {};
        const persons: Record<string, string | null> = {};
        for (const l of (loggers as any[]) || []) {
          map[l.player_tag] = l.person?.display_name || l.in_game_name || l.player_tag;
          persons[l.player_tag] = l.person_id ?? null;
        }
        setLoggerNames(map);
        setAuthorPersons(persons);
      } else {
        setLoggerNames({});
        setAuthorPersons({});
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
          description,
          loggedAt: backdate && loggedAt ? dateToNoonIso(loggedAt) : null
        }),
      });

      if (res.ok) {
        setShowLogModal(false);
        setSelectedPerson('');
        setSelectedAccount('');
        setSelectedRule('');
        setDescription('');
        setBackdate(false);
        setLoggedAt('');
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Error logging warning');
      }
    } catch (err) { alert('Error logging warning'); }
  }

  // Author check resolved at the person level: the actor's account OR any alt sharing the
  // same persona as the original author may edit. Falls back to a raw tag match.
  function isAuthoredByMe(authorTag: string) {
    if (currentUserTag && authorTag === currentUserTag) return true;
    return !!myPersonId && authorPersons[authorTag] != null && authorPersons[authorTag] === myPersonId;
  }

  function openEditModal(w: ExtendedWarning) {
    setEditingWarning(w);
    setEditRule(w.rule_id || '');
    setEditDescription(w.description);
    setEditLoggedAt(toLocalDate(w.logged_at));
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingWarning) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/warnings/${editingWarning.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ruleId: editRule || null,
          description: editDescription,
          loggedAt: dateToNoonIso(editLoggedAt),
        }),
      });
      if (res.ok) {
        setEditingWarning(null);
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Error updating warning');
      }
    } catch (err) {
      alert('Error updating warning');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleAddNote(warningId: string) {
    const body = (noteDrafts[warningId] || '').trim();
    if (!body) return;
    setPostingNote(warningId);
    try {
      const res = await fetch(`/api/warnings/${warningId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setNoteDrafts(prev => ({ ...prev, [warningId]: '' }));
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Error adding note');
      }
    } catch (err) {
      alert('Error adding note');
    } finally {
      setPostingNote(null);
    }
  }

  async function handleSaveNote(warningId: string, noteId: string) {
    const body = editNoteDraft.trim();
    if (!body) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/warnings/${warningId}/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setEditingNoteId(null);
        setEditNoteDraft('');
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Error saving note');
      }
    } catch (err) {
      alert('Error saving note');
    } finally {
      setSavingNote(false);
    }
  }

  async function handleDeleteNote(warningId: string, noteId: string) {
    try {
      const res = await fetch(`/api/warnings/${warningId}/notes/${noteId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Error deleting note');
      }
    } catch (err) {
      alert('Error deleting note');
    }
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
      <div className="responsive-header">
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Warning Log</h1>
          <p className="text-muted">Track and escalate rule violations across the clan family.</p>
        </div>
        
        <div className="header-actions">
           <select className="input filter-select" value={filterStatus} onChange={(e: any) => setFilterStatus(e.target.value)}>
             <option value="all">All Statuses</option>
             <option value="high">High Escalation</option>
             <option value="pending">Pending</option>
             <option value="acknowledged">Acknowledged</option>
           </select>
           <button className="btn btn-primary" onClick={() => setShowLogModal(true)} style={{ whiteSpace: 'nowrap' }}>
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
                <div className="warning-card-layout">
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-xs)', flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0 }}>{w.person.display_name}</h3>
                      {high && <span style={{ fontSize: '0.65rem', padding: '2px 8px', background: 'var(--color-danger)', color: '#fff', borderRadius: '10px', fontWeight: '700' }}>HIGH ESCALATION</span>}
                      {w.acknowledged && <span style={{ fontSize: '0.65rem', padding: '2px 8px', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-cta)', borderRadius: '10px', fontWeight: '700' }}>ACKNOWLEDGED</span>}
                    </div>
                    <p style={{ fontSize: '0.9rem', marginBottom: 'var(--space-sm)' }}><span className="text-muted">Rule: </span><span style={{ fontWeight: '600' }}>{w.rule?.name || 'General Violation'}</span></p>
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text)', marginBottom: 'var(--space-md)', lineHeight: '1.5' }}>{w.description}</p>
                    <div className="warning-card-meta text-muted">
                       <span>Account: <strong>{w.player_account.in_game_name} ({w.player_account_tag})</strong></span>
                       <span>Logged by: <strong>{loggerNames[w.logged_by] || w.logged_by}</strong></span>
                       <span>When: <strong>{new Date(w.logged_at).toLocaleString()}</strong>{w.edited_at ? <span className="text-muted"> (edited)</span> : null}</span>
                    </div>
                  </div>
                  <div className="warning-card-actions" style={{ marginLeft: 'var(--space-xl)' }}>
                    <button className={`btn ${w.acknowledged ? 'btn-outline' : 'btn-primary'}`} style={{ border: w.acknowledged ? '1px solid rgba(255,255,255,0.1)' : '', color: w.acknowledged ? 'var(--color-muted)' : '', padding: '0.5rem 1rem', fontSize: '0.75rem' }} onClick={() => handleAcknowledge(w.id, w.acknowledged)}>
                      {w.acknowledged ? <CheckCircle size={16} /> : 'Acknowledge'}
                    </button>
                    {isAuthoredByMe(w.logged_by) && (
                      <button className="btn btn-outline" style={{ border: '1px solid rgba(255,255,255,0.1)', color: 'var(--color-muted)', padding: '0.5rem 1rem', fontSize: '0.75rem' }} onClick={() => openEditModal(w)}>
                        <Pencil size={16} /> Edit
                      </button>
                    )}
                    <button className="btn btn-outline" style={{ border: 'none', color: 'var(--color-danger)', padding: '0.5rem 1rem', fontSize: '0.75rem' }} onClick={() => setConfirmConfig({ isOpen: true, id: w.id, title: 'Delete Warning', message: `Permanently remove warning for ${w.person.display_name}? This cannot be undone.` })}>
                      <Trash2 size={16} /> Delete
                    </button>
                  </div>
                </div>

                {/* Progress notes */}
                <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <button
                    onClick={() => setOpenNotes(prev => ({ ...prev, [w.id]: !prev[w.id] }))}
                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                  >
                    <MessageSquare size={15} />
                    Notes {w.warning_notes.length > 0 ? `(${w.warning_notes.length})` : ''}
                    <ChevronDown size={14} style={{ transform: openNotes[w.id] ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }} />
                  </button>

                  {openNotes[w.id] && (
                    <div style={{ marginTop: 'var(--space-md)' }}>
                      {w.warning_notes.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                          {[...w.warning_notes].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map(n => {
                            const mine = isAuthoredByMe(n.author_tag);
                            const edited = n.updated_at && n.updated_at !== n.created_at;
                            return (
                              <div key={n.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)' }}>
                                {editingNoteId === n.id ? (
                                  <div>
                                    <textarea className="input" rows={2} value={editNoteDraft} onChange={(e) => setEditNoteDraft(e.target.value)} style={{ resize: 'vertical' }} />
                                    <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
                                      <button onClick={() => { setEditingNoteId(null); setEditNoteDraft(''); }} className="btn btn-outline" style={{ border: 'none', padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>Cancel</button>
                                      <button onClick={() => handleSaveNote(w.id, n.id)} disabled={savingNote || !editNoteDraft.trim()} className="btn btn-primary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>{savingNote ? 'Saving...' : 'Save'}</button>
                                    </div>
                                  </div>
                                ) : (
                                  <div>
                                    <p style={{ fontSize: '0.85rem', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{n.body}</p>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                                        {loggerNames[n.author_tag] || n.author_tag} • {new Date(n.created_at).toLocaleDateString()}{edited ? ' (edited)' : ''}
                                      </span>
                                      {mine && (
                                        <span style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                          <button onClick={() => { setEditingNoteId(n.id); setEditNoteDraft(n.body); }} style={{ background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }} title="Edit"><Pencil size={13} /></button>
                                          <button onClick={() => handleDeleteNote(w.id, n.id)} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }} title="Delete"><Trash2 size={13} /></button>
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-end' }}>
                        <textarea
                          className="input"
                          rows={1}
                          placeholder="Add a progress note..."
                          value={noteDrafts[w.id] || ''}
                          onChange={(e) => setNoteDrafts(prev => ({ ...prev, [w.id]: e.target.value }))}
                          style={{ resize: 'vertical', flex: 1 }}
                        />
                        <button onClick={() => handleAddNote(w.id)} disabled={postingNote === w.id || !(noteDrafts[w.id] || '').trim()} className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                          <Send size={14} /> {postingNote === w.id ? 'Posting...' : 'Post'}
                        </button>
                      </div>
                    </div>
                  )}
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
               <div className="responsive-grid-2" style={{ marginBottom: 'var(--space-md)' }}>
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
               <div style={{ marginBottom: 'var(--space-md)' }}>
                  <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Context</label>
                  <textarea className="input" rows={4} placeholder="Describe the violation..." value={description} onChange={(e) => setDescription(e.target.value)} required />
               </div>
               <div style={{ marginBottom: 'var(--space-lg)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer', fontSize: '0.85rem' }}>
                    <input type="checkbox" checked={backdate} onChange={(e) => { setBackdate(e.target.checked); if (!e.target.checked) setLoggedAt(''); }} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                    Backdate this warning
                  </label>
                  {backdate && (
                    <div style={{ marginTop: 'var(--space-sm)' }}>
                      <input
                        type="date"
                        className="input"
                        value={loggedAt}
                        max={toLocalDate(new Date().toISOString())}
                        onChange={(e) => setLoggedAt(e.target.value)}
                        required
                      />
                      <p className="text-muted" style={{ fontSize: '0.7rem', margin: '4px 0 0' }}>The day the violation occurred. Must be in the past; escalation is calculated from this date.</p>
                    </div>
                  )}
               </div>
               <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Finalize Log</button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Warning Modal */}
      {editingWarning && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Edit Warning</h2>
                <p className="text-muted" style={{ margin: '2px 0 0', fontSize: '0.8rem' }}>{editingWarning.person.display_name} — {editingWarning.player_account.in_game_name}</p>
              </div>
              <X onClick={() => setEditingWarning(null)} style={{ cursor: 'pointer' }} />
            </div>
            <form onSubmit={handleSaveEdit} style={{ padding: 'var(--space-lg)' }}>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                  <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Rule</label>
                  <select className="input" value={editRule} onChange={(e) => setEditRule(e.target.value)}>
                    <option value="">No specific rule</option>
                    {rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
               </div>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                  <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Context</label>
                  <textarea className="input" rows={4} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} required />
               </div>
               <div style={{ marginBottom: 'var(--space-lg)' }}>
                  <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Date of violation</label>
                  <input
                    type="date"
                    className="input"
                    value={editLoggedAt}
                    max={toLocalDate(new Date().toISOString())}
                    onChange={(e) => setEditLoggedAt(e.target.value)}
                    required
                  />
                  <p className="text-muted" style={{ fontSize: '0.7rem', margin: '4px 0 0' }}>Must be in the past; escalation is recalculated from this date.</p>
               </div>
               <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={savingEdit}>{savingEdit ? 'Saving...' : 'Save Changes'}</button>
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
