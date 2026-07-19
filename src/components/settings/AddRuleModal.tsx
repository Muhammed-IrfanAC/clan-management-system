'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useSettingsStore } from '@/lib/stores/settingsStore';

// Create a new system rule. Owns its own form + submit guard; the store owns the mutation.
export default function AddRuleModal({ onClose }: { onClose: () => void }) {
  const addRule = useSettingsStore((s) => s.addRule);
  const [form, setForm] = useState({ name: '', description: '', guidance: '' });
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const ok = await addRule(form);
    setSubmitting(false);
    if (ok) onClose();
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>Create System Rule</h2>
          <X onClick={onClose} style={{ cursor: 'pointer' }} />
        </div>
        <form onSubmit={handleSubmit} style={{ padding: 'var(--space-lg)' }}>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Rule Name</label>
            <input className="input" placeholder="e.g. Miss War Attack" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Description</label>
            <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required />
          </div>
          <div style={{ marginBottom: 'var(--space-lg)' }}>
            <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Logging Guidance (Tips for leaders)</label>
            <input className="input" value={form.guidance} onChange={(e) => setForm({ ...form, guidance: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={submitting}>{submitting ? 'Saving...' : 'Save Rule'}</button>
        </form>
      </div>
    </div>
  );
}
