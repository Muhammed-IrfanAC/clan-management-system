'use client';

import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { useActivityStore, type ExtendedLog } from '@/lib/stores/activityStore';
import { useClan } from '@/lib/ClanContext';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import Toast from '@/components/ui/Toast';
import ActivityCard from '@/components/activity/ActivityCard';
import LogFormModal from '@/components/activity/LogFormModal';

export default function ActivityPage() {
  const { selectedClanId } = useClan();

  const logs = useActivityStore((s) => s.logs);
  const loading = useActivityStore((s) => s.loading);
  const toast = useActivityStore((s) => s.toast);
  const setToast = useActivityStore((s) => s.setToast);
  const addingLog = useActivityStore((s) => s.addingLog);
  const savingEdit = useActivityStore((s) => s.savingEdit);
  const deleting = useActivityStore((s) => s.deleting);
  const fetchData = useActivityStore((s) => s.fetchData);
  const loadIdentity = useActivityStore((s) => s.loadIdentity);
  const addLog = useActivityStore((s) => s.addLog);
  const saveEdit = useActivityStore((s) => s.saveEdit);
  const deleteLog = useActivityStore((s) => s.deleteLog);

  // View + modal orchestration is UI-local; the store owns the feed and its mutations.
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'completed'>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingLog, setEditingLog] = useState<ExtendedLog | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    fetchData(selectedClanId);
  }, [selectedClanId, fetchData]);

  useEffect(() => {
    loadIdentity();
  }, [loadIdentity]);

  const filteredLogs = logs.filter((log) => {
    if (filterStatus === 'active') return !log.completed;
    if (filterStatus === 'completed') return log.completed;
    return true;
  });

  async function handleConfirmDelete() {
    if (confirmId && (await deleteLog(confirmId))) setConfirmId(null);
  }

  return (
    <div>
      <div className="responsive-header">
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: 'var(--space-xs)' }}>Leadership Activity</h1>
          <p className="text-muted">Global record of leadership decisions and clan events.</p>
        </div>

        <div className="header-actions">
          <select className="input filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
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
          filteredLogs.map((log) => (
            <ActivityCard key={log.id} log={log} onEdit={setEditingLog} onRequestDelete={setConfirmId} />
          ))
        )}
      </div>

      {showAddModal && (
        <LogFormModal
          title="Log Leadership Action"
          submitLabel="Save Entry"
          saving={addingLog}
          initial={{ category: 'general', clanId: '', personId: '', description: '', pinned: false }}
          onClose={() => setShowAddModal(false)}
          onSubmit={addLog}
        />
      )}

      {editingLog && (
        <LogFormModal
          title="Edit Entry"
          submitLabel="Save Changes"
          saving={savingEdit}
          initial={{
            category: editingLog.category,
            clanId: editingLog.clan_id || '',
            personId: editingLog.related_person_id || '',
            description: editingLog.description,
            pinned: editingLog.pinned,
          }}
          onClose={() => setEditingLog(null)}
          onSubmit={(form) => saveEdit(editingLog.id, form)}
        />
      )}

      <ConfirmationModal
        isOpen={confirmId !== null}
        onClose={() => setConfirmId(null)}
        onConfirm={handleConfirmDelete}
        title="Delete Entry"
        message="Permanently remove this leadership record?"
        isLoading={deleting}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
