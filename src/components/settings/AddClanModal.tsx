'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useSettingsStore } from '@/lib/stores/settingsStore';

// Register a new family clan. Owns its own form + submit guard; the store owns the mutation and
// closes this on success.
export default function AddClanModal({ onClose }: { onClose: () => void }) {
  const addClan = useSettingsStore((s) => s.addClan);
  const [form, setForm] = useState({ tag: '', name: '', type: 'main' });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const ok = await addClan(form);
    setSubmitting(false);
    if (ok) onClose();
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Register New Clan</h2>
          <X onClick={onClose} style={{ cursor: 'pointer' }} />
        </div>
        <form onSubmit={handleSubmit} style={{ padding: 'var(--space-lg)' }}>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Clan Tag</label>
            <input className="input" placeholder="#29L..." value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} required />
          </div>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Display Name</label>
            <input className="input" placeholder="e.g. Main Clan" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Role</label>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="main">Main Clan</option>
              <option value="feeder">Feeder Clan</option>
            </select>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>{submitting ? 'Initializing...' : 'Initialize Clan'}</button>
        </form>
      </div>
    </div>
  );
}
