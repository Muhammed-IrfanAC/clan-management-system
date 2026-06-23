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
  CheckCircle,
  X,
  Trash2
} from 'lucide-react';
import { LeadershipLog, Clan, Person } from '@/types/database';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useClan } from '@/lib/ClanContext';

type ExtendedLog = LeadershipLog & {
  clan: Clan | null;
  person: Person | null;
  completed: boolean;
};

export default function ActivityPage() {
  const { selectedClanId } = useClan();
  const [logs, setLogs] = useState<ExtendedLog[]>([]);
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

  // Form state
  const [category, setCategory] = useState('general');
  const [clanId, setClanId] = useState('');
  const [personId, setPersonId] = useState('');
  const [description, setDescription] = useState('');
  const [pinned, setPinned] = useState(false);
  
  const [clans, setClans] = useState<Clan[]>([]);
  const [persons, setPersons] = useState<Person[]>([]);

  useEffect(() => {
    fetchData();
  }, [selectedClanId]);

  async function fetchData() {
    setLoading(true);
    try {
      let req = supabase
        .from('leadership_logs')
        .select(`
          *,
          clan:clans (*),
          person:persons (*)
        `)
        .order('pinned', { ascending: false })
        .order('logged_at', { ascending: false });
      
      if (selectedClanId !== 'all') req = req.eq('clan_id', selectedClanId);

      const { data } = await req;
      setLogs(data as ExtendedLog[] || []);

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
    } catch (err) { alert('Error adding log'); }
  }

  async function handleToggleComplete(id: string, current: boolean) {
    try {
      const res = await fetch(`/api/activity/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !current }),
      });
      if (res.ok) fetchData();
    } catch (err) { alert('Error updating log status'); }
  }

  async function deleteLog() {
    try {
      const res = await fetch(`/api/activity/${confirmConfig.id}`, { method: 'DELETE' });
      if (res.ok) {
        setConfirmConfig({ ...confirmConfig, isOpen: false });
        fetchData();
      }
    } catch (err) { alert('Error deleting log'); }
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
                      <span>By: <strong>{log.logged_by}</strong></span>
                    </div>
                  </div>
                </div>

                <div className="warning-card-actions">
                   <button 
                    onClick={() => handleToggleComplete(log.id, log.completed)}
                    className={`btn ${log.completed ? 'btn-outline' : 'btn-primary'}`}
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', border: log.completed ? '1px solid rgba(255,255,255,0.1)' : '' }}
                   >
                     {log.completed ? 'Re-open' : 'Complete'}
                   </button>
                   <button 
                    onClick={() => setConfirmConfig({ isOpen: true, id: log.id, title: 'Delete Entry', message: 'Permanently remove this leadership record?' })}
                    className="btn btn-outline"
                    style={{ padding: '0.4rem 0.8rem', fontSize: '0.7rem', border: 'none', color: 'var(--color-danger)' }}
                   >
                     <Trash2 size={14} /> Delete
                   </button>
                </div>
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
               <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Save Entry</button>
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
      />
    </div>
  );
}
