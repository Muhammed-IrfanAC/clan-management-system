'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import {
  History,
  Plus,
  Pin,
  User,
  Shield,
  Sword,
  Tag,
  X,
  Trash2,
  Pencil,
  MessageSquare,
  Send,
  ChevronDown
} from 'lucide-react';
import { LeadershipLog, Clan, Person, ActivityNote } from '@/types/database';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useClan } from '@/lib/ClanContext';

type ExtendedLog = LeadershipLog & {
  clan: Clan | null;
  person: Person | null;
  completed: boolean;
  activity_notes: ActivityNote[];
};

export default function ActivityPage() {
  const { selectedClanId } = useClan();
  const [logs, setLogs] = useState<ExtendedLog[]>([]);
  const [loggerNames, setLoggerNames] = useState<Record<string, string>>({});
  // player_tag -> person_id, so an author's alts are recognised for edit/delete controls.
  const [authorPersons, setAuthorPersons] = useState<Record<string, string | null>>({});
  const [currentUserTag, setCurrentUserTag] = useState<string | null>(null);
  const [myPersonId, setMyPersonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');

  // Confirmation Modal
  const [confirmConfig, setConfirmConfig] = useState({
    isOpen: false,
    id: '',
    title: '',
    message: ''
  });

  // In-flight guards
  const [addingLog, setAddingLog] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form state
  const [category, setCategory] = useState('general');
  const [clanId, setClanId] = useState('');
  const [personId, setPersonId] = useState('');
  const [description, setDescription] = useState('');
  const [pinned, setPinned] = useState(false);

  const [clans, setClans] = useState<Clan[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);

  // Edit modal state
  const [editingLog, setEditingLog] = useState<ExtendedLog | null>(null);
  const [editCategory, setEditCategory] = useState('general');
  const [editClanId, setEditClanId] = useState('');
  const [editPersonId, setEditPersonId] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPinned, setEditPinned] = useState(false);
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

  useEffect(() => {
    // Identify the acting leader (and their persona) so edit controls appear on entries
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
      let req = supabase
        .from('leadership_logs')
        .select(`
          *,
          clan:clans (*),
          person:persons (*),
          activity_notes (*)
        `)
        .order('pinned', { ascending: false })
        .order('logged_at', { ascending: false });

      if (selectedClanId !== 'all') req = req.eq('clan_id', selectedClanId);

      const { data } = await req;
      const logRows = (data as ExtendedLog[]) || [];
      setLogs(logRows);

      // Resolve player_tags (entry loggers + note authors) to a display name and persona.
      const loggerTags = Array.from(new Set(logRows.flatMap(l => [
        l.logged_by,
        ...((l.activity_notes || []).map(n => n.author_tag)),
      ]).filter(Boolean)));
      if (loggerTags.length) {
        const { data: loggers } = await supabase
          .from('player_accounts')
          .select('player_tag, person_id, in_game_name, person:persons (display_name)')
          .in('player_tag', loggerTags);
        const map: Record<string, string> = {};
        const personMap: Record<string, string | null> = {};
        for (const l of (loggers as any[]) || []) {
          map[l.player_tag] = l.person?.display_name || l.in_game_name || l.player_tag;
          personMap[l.player_tag] = l.person_id ?? null;
        }
        setLoggerNames(map);
        setAuthorPersons(personMap);
      } else {
        setLoggerNames({});
        setAuthorPersons({});
      }

      const { data: clansData } = await supabase.from('clans').select('*');
      setClans(clansData || []);

      const { data: personsData } = await supabase.from('persons').select('*').order('display_name');
      setPersons(personsData || []);

    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddLog(e: React.FormEvent) {
    e.preventDefault();
    if (addingLog) return;
    setAddingLog(true);
    try {
      const res = await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, clanId, personId, description, pinned }),
      });

      if (res.ok) {
        setShowAddModal(false);
        setCategory('general');
        setClanId('');
        setPersonId('');
        setDescription('');
        setPinned(false);
        fetchData();
      }
    } catch (err) { alert('Error adding log'); } finally { setAddingLog(false); }
  }

  async function handleToggleComplete(id: string, current: boolean) {
    if (togglingId === id) return;
    setTogglingId(id);
    try {
      const res = await fetch(`/api/activity/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !current }),
      });
      if (res.ok) fetchData();
    } catch (err) { alert('Error updating log status'); } finally { setTogglingId(null); }
  }

  // Author check resolved at the person level: the actor's account OR any alt sharing the
  // same persona as the original author may edit. Falls back to a raw tag match.
  function isAuthoredByMe(authorTag: string) {
    if (currentUserTag && authorTag === currentUserTag) return true;
    return !!myPersonId && authorPersons[authorTag] != null && authorPersons[authorTag] === myPersonId;
  }

  function openEditModal(log: ExtendedLog) {
    setEditingLog(log);
    setEditCategory(log.category);
    setEditClanId(log.clan_id || '');
    setEditPersonId(log.related_person_id || '');
    setEditDescription(log.description);
    setEditPinned(log.pinned);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingLog) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/activity/${editingLog.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: editCategory,
          clanId: editClanId || null,
          personId: editPersonId || null,
          description: editDescription,
          pinned: editPinned,
        }),
      });
      if (res.ok) {
        setEditingLog(null);
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Error updating entry');
      }
    } catch (err) {
      alert('Error updating entry');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleAddNote(logId: string) {
    const body = (noteDrafts[logId] || '').trim();
    if (!body) return;
    setPostingNote(logId);
    try {
      const res = await fetch(`/api/activity/${logId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        setNoteDrafts(prev => ({ ...prev, [logId]: '' }));
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

  async function handleSaveNote(logId: string, noteId: string) {
    const body = editNoteDraft.trim();
    if (!body) return;
    setSavingNote(true);
    try {
      const res = await fetch(`/api/activity/${logId}/notes/${noteId}`, {
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

  async function handleDeleteNote(logId: string, noteId: string) {
    if (deletingNoteId === noteId) return;
    setDeletingNoteId(noteId);
    try {
      const res = await fetch(`/api/activity/${logId}/notes/${noteId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Error deleting note');
      }
    } catch (err) {
      alert('Error deleting note');
    } finally {
      setDeletingNoteId(null);
    }
  }

  async function deleteLog() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/activity/${confirmConfig.id}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmConfig({ ...confirmConfig, isOpen: false });
        fetchData();
      }
    } catch (err) { alert('Error deleting log'); } finally { setDeleting(false); }
  }

  const categoryIcons: any = {
    promotion: <Shield size={16} className="text-cta" />,
    demotion: <Shield size={16} className="text-danger" />,
    war: <Sword size={16} />,
    recruitment: <User size={16} />,
    capital: <Tag size={16} />,
    general: <History size={16} />
  };

  const filteredLogs = logs.filter(log => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'active') return !log.completed;
    if (filterStatus === 'completed') return log.completed;
    return true;
  });

  return (
    <div>
      <div className="responsive-header">
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Leadership Activity</h1>
          <p className="text-muted">Global record of leadership decisions and clan events.</p>
        </div>

        <div className="header-actions">
           <select className="input filter-select" value={filterStatus} onChange={(e: any) => setFilterStatus(e.target.value)}>
             <option value="all">All Entries</option>
             <option value="active">Active Tasks</option>
             <option value="completed">Completed</option>
           </select>
           <button className="btn btn-primary" onClick={() => setShowAddModal(true)} style={{ whiteSpace: 'nowrap' }}>
             <Plus size={20} /> Add Entry
           </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
        {loading ? (
          <p className="text-muted">Loading activity...</p>
        ) : filteredLogs.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-3xl)' }}>
            <p className="text-muted">No activity logs found for this filter.</p>
          </div>
        ) : (
          filteredLogs.map(log => (
            <div key={log.id} className="card" style={{
              borderLeft: log.pinned ? '4px solid var(--color-cta)' : '1px solid rgba(255,255,255,0.05)',
              opacity: log.completed ? 0.7 : 1
            }}>
              <div className="warning-card-layout" style={{ gap: 'var(--space-lg)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-lg)', flex: 1, minWidth: 0 }}>
                  <div style={{
                    width: '40px', height: '40px',
                    background: 'var(--color-primary)',
                    borderRadius: 'var(--radius-md)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0
                  }}>
                    {categoryIcons[log.category] || <History size={16} />}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-xs)', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                        <span style={{ fontWeight: '700', textTransform: 'uppercase', fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                          {log.category}
                        </span>
                        {log.pinned && <Pin size={14} className="text-cta" />}
                        {log.completed && <span style={{ fontSize: '0.6rem', padding: '1px 6px', background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-cta)', borderRadius: '4px' }}>COMPLETED</span>}
                      </div>
                      <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                        {new Date(log.logged_at).toLocaleString()}
                      </span>
                    </div>

                    <p style={{ margin: 0, lineHeight: '1.6', color: log.completed ? 'var(--color-muted)' : 'var(--color-text)', textDecoration: log.completed ? 'line-through' : 'none' }}>
                      {log.description}
                    </p>

                    <div className="warning-card-meta text-muted" style={{ marginTop: 'var(--space-sm)' }}>
                      {log.clan && <span>Clan: <strong>{log.clan.display_name}</strong></span>}
                      {log.person && <span>Related: <strong>{log.person.display_name}</strong></span>}
                      <span>By: <strong>{loggerNames[log.logged_by] || log.logged_by}</strong>{log.edited_at ? <span className="text-muted"> (edited)</span> : null}</span>
                    </div>
                  </div>
                </div>

                <div className="warning-card-actions">
                   <button
                    onClick={() => handleToggleComplete(log.id, log.completed)}
                    disabled={togglingId === log.id}
                    className={`btn ${log.completed ? 'btn-outline' : 'btn-primary'}`}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', border: log.completed ? '1px solid rgba(255,255,255,0.1)' : '' }}
                   >
                     {log.completed ? 'Re-open' : 'Complete'}
                   </button>
                   {isAuthoredByMe(log.logged_by) && (
                     <button
                      onClick={() => openEditModal(log)}
                      className="btn btn-outline"
                      style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--color-muted)' }}
                     >
                       <Pencil size={14} /> Edit
                     </button>
                   )}
                   <button
                    onClick={() => setConfirmConfig({ isOpen: true, id: log.id, title: 'Delete Entry', message: 'Permanently remove this leadership record?' })}
                    className="btn btn-outline"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', border: 'none', color: 'var(--color-danger)' }}
                   >
                     <Trash2 size={14} /> Delete
                   </button>
                </div>
              </div>

              {/* Progress notes */}
              <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <button
                  onClick={() => setOpenNotes(prev => ({ ...prev, [log.id]: !prev[log.id] }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                >
                  <MessageSquare size={15} />
                  Notes {log.activity_notes.length > 0 ? `(${log.activity_notes.length})` : ''}
                  <ChevronDown size={14} style={{ transform: openNotes[log.id] ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }} />
                </button>

                {openNotes[log.id] && (
                  <div style={{ marginTop: 'var(--space-md)' }}>
                    {log.activity_notes.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
                        {[...log.activity_notes].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).map(n => {
                          const mine = isAuthoredByMe(n.author_tag);
                          const edited = n.updated_at && n.updated_at !== n.created_at;
                          return (
                            <div key={n.id} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-md)', padding: 'var(--space-sm) var(--space-md)' }}>
                              {editingNoteId === n.id ? (
                                <div>
                                  <textarea className="input" rows={2} value={editNoteDraft} onChange={(e) => setEditNoteDraft(e.target.value)} style={{ resize: 'vertical' }} />
                                  <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end', marginTop: 'var(--space-sm)' }}>
                                    <button onClick={() => { setEditingNoteId(null); setEditNoteDraft(''); }} className="btn btn-outline" style={{ border: 'none', padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>Cancel</button>
                                    <button onClick={() => handleSaveNote(log.id, n.id)} disabled={savingNote || !editNoteDraft.trim()} className="btn btn-primary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>{savingNote ? 'Saving...' : 'Save'}</button>
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
                                        <button onClick={() => handleDeleteNote(log.id, n.id)} disabled={deletingNoteId === n.id} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }} title="Delete"><Trash2 size={13} /></button>
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
                        value={noteDrafts[log.id] || ''}
                        onChange={(e) => setNoteDrafts(prev => ({ ...prev, [log.id]: e.target.value }))}
                        style={{ resize: 'vertical', flex: 1 }}
                      />
                      <button onClick={() => handleAddNote(log.id)} disabled={postingNote === log.id || !(noteDrafts[log.id] || '').trim()} className="btn btn-primary" style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                        <Send size={14} /> {postingNote === log.id ? 'Posting...' : 'Post'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Log Modal */}
      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Log Leadership Action</h2>
              <X onClick={() => setShowAddModal(false)} style={{ cursor: 'pointer' }} />
            </div>
            <form onSubmit={handleAddLog} style={{ padding: 'var(--space-lg)' }}>
               <div className="responsive-grid-2" style={{ marginBottom: 'var(--space-md)' }}>
                  <div>
                    <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Category</label>
                    <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} required>
                      <option value="general">General</option>
                      <option value="promotion">Promotion</option>
                      <option value="demotion">Demotion</option>
                      <option value="war">War</option>
                      <option value="recruitment">Recruitment</option>
                      <option value="capital">Capital</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Clan (Optional)</label>
                    <select className="input" value={clanId} onChange={(e) => setClanId(e.target.value)}>
                      <option value="">Family-wide</option>
                      {clans.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                    </select>
                  </div>
               </div>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                  <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Related Person (Optional)</label>
                  <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                    <option value="">None</option>
                    {persons.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </select>
               </div>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                  <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Description</label>
                  <textarea className="input" rows={4} placeholder="Describe the decision or event..." value={description} onChange={(e) => setDescription(e.target.value)} required />
               </div>
               <div style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                  <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} id="pinned" />
                  <label htmlFor="pinned" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>Pin this entry to top</label>
               </div>
               <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={addingLog}>{addingLog ? 'Saving...' : 'Save Entry'}</button>
            </form>
          </div>
        </div>
      )}

      {/* Edit Log Modal */}
      {editingLog && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '600px' }}>
            <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Edit Entry</h2>
              <X onClick={() => setEditingLog(null)} style={{ cursor: 'pointer' }} />
            </div>
            <form onSubmit={handleSaveEdit} style={{ padding: 'var(--space-lg)' }}>
               <div className="responsive-grid-2" style={{ marginBottom: 'var(--space-md)' }}>
                  <div>
                    <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Category</label>
                    <select className="input" value={editCategory} onChange={(e) => setEditCategory(e.target.value)} required>
                      <option value="general">General</option>
                      <option value="promotion">Promotion</option>
                      <option value="demotion">Demotion</option>
                      <option value="war">War</option>
                      <option value="recruitment">Recruitment</option>
                      <option value="capital">Capital</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Clan (Optional)</label>
                    <select className="input" value={editClanId} onChange={(e) => setEditClanId(e.target.value)}>
                      <option value="">Family-wide</option>
                      {clans.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                    </select>
                  </div>
               </div>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                  <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Related Person (Optional)</label>
                  <select className="input" value={editPersonId} onChange={(e) => setEditPersonId(e.target.value)}>
                    <option value="">None</option>
                    {persons.map(p => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </select>
               </div>
               <div style={{ marginBottom: 'var(--space-md)' }}>
                  <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Description</label>
                  <textarea className="input" rows={4} value={editDescription} onChange={(e) => setEditDescription(e.target.value)} required />
               </div>
               <div style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
                  <input type="checkbox" checked={editPinned} onChange={(e) => setEditPinned(e.target.checked)} id="edit-pinned" />
                  <label htmlFor="edit-pinned" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>Pin this entry to top</label>
               </div>
               <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={savingEdit}>{savingEdit ? 'Saving...' : 'Save Changes'}</button>
            </form>
          </div>
        </div>
      )}

      <ConfirmationModal
        isOpen={confirmConfig.isOpen}
        onClose={() => setConfirmConfig({ ...confirmConfig, isOpen: false, id: '' })}
        onConfirm={deleteLog}
        title={confirmConfig.title}
        message={confirmConfig.message}
        isLoading={deleting}
      />
    </div>
  );
}
