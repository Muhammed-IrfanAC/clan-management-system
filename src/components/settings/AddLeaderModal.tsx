'use client';

import { useState } from 'react';
import { X, AlertCircle } from 'lucide-react';
import { useSettingsStore } from '@/lib/stores/settingsStore';
import { assignableRoles } from '@/lib/permissions';
import type { AccessRole } from '@/types/database';

const ROLE_LABELS: Record<AccessRole, string> = {
  super_admin: 'Super Admin',
  leader: 'Leader',
  co_leader: 'Co-Leader',
};

// Grant dashboard access to a registry member. Access is a person-level grant, addressed via one of
// the person's account tags. Owns its picker + role draft; the store owns the candidate list and the
// mutation. The assignable roles are capped by the acting role (see assignableRoles).
export default function AddLeaderModal({ role, onClose }: { role: AccessRole | null; onClose: () => void }) {
  const personOptions = useSettingsStore((s) => s.personOptions);
  const addLeader = useSettingsStore((s) => s.addLeader);

  const [personQuery, setPersonQuery] = useState('');
  const [selectedPersonId, setSelectedPersonId] = useState('');
  const [newLeaderRole, setNewLeaderRole] = useState<AccessRole>('co_leader');
  const [submitting, setSubmitting] = useState(false);

  const matches = personOptions.filter((p) => p.display_name.toLowerCase().includes(personQuery.trim().toLowerCase()));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const person = personOptions.find((p) => p.person_id === selectedPersonId);
    if (!person) return;
    setSubmitting(true);
    const ok = await addLeader(person.player_tag, newLeaderRole);
    setSubmitting(false);
    if (ok) onClose();
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Authorize Leadership</h2>
          <X onClick={onClose} style={{ cursor: 'pointer' }} />
        </div>
        <form onSubmit={handleSubmit} style={{ padding: 'var(--space-lg)' }}>
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
              onChange={(e) => { setPersonQuery(e.target.value); setSelectedPersonId(''); }}
              style={{ marginBottom: 'var(--space-sm)' }}
            />
            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius-md)' }}>
              {matches.slice(0, 50).map((p) => (
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
              {matches.length === 0 && (
                <div className="text-muted" style={{ padding: 'var(--space-md)', fontSize: '0.75rem' }}>No matching members without access.</div>
              )}
            </div>
          </div>
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Role</label>
            <select className="input" value={newLeaderRole} onChange={(e) => setNewLeaderRole(e.target.value as AccessRole)}>
              {assignableRoles(role).map((r) => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
            <p className="text-muted" style={{ fontSize: '0.65rem', marginTop: 'var(--space-xs)' }}>{role === 'super_admin' ? 'The Super Admin role itself is set directly in the database.' : 'Only the Super Admin can grant the Leader role.'}</p>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={!selectedPersonId || submitting}>{submitting ? 'Granting...' : 'Grant Dashboard Access'}</button>
        </form>
      </div>
    </div>
  );
}
