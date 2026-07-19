'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { useActivityStore, type LogForm } from '@/lib/stores/activityStore';

// Shared add/edit modal for a leadership log. The clan/person option lists come from the store;
// the form values stay local (seeded from `initial`) and are handed back up via onSubmit, which
// resolves true on success so the parent can close the modal.
export default function LogFormModal({
  title,
  submitLabel,
  initial,
  saving,
  onClose,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initial: LogForm;
  saving: boolean;
  onClose: () => void;
  onSubmit: (form: LogForm) => Promise<boolean>;
}) {
  const clans = useActivityStore((s) => s.clans);
  const persons = useActivityStore((s) => s.persons);

  const [form, setForm] = useState<LogForm>(initial);
  const set = <K extends keyof LogForm>(key: K, value: LogForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (await onSubmit(form)) onClose();
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '600px' }}>
        <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{title}</h2>
          <X onClick={onClose} style={{ cursor: 'pointer' }} />
        </div>
        <form onSubmit={handleSubmit} style={{ padding: 'var(--space-lg)' }}>
          <div className="responsive-grid-2" style={{ marginBottom: 'var(--space-md)' }}>
            <div>
              <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Category</label>
              <select className="input" value={form.category} onChange={(e) => set('category', e.target.value)} required>
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
              <select className="input" value={form.clanId} onChange={(e) => set('clanId', e.target.value)}>
                <option value="">Family-wide</option>
                {clans.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Related Person (Optional)</label>
            <select className="input" value={form.personId} onChange={(e) => set('personId', e.target.value)}>
              <option value="">None</option>
              {persons.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 'var(--space-md)' }}>
            <label className="text-muted" style={{ fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase' }}>Description</label>
            <textarea className="input" rows={4} placeholder="Describe the decision or event..." value={form.description} onChange={(e) => set('description', e.target.value)} required />
          </div>
          <div style={{ marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <input type="checkbox" checked={form.pinned} onChange={(e) => set('pinned', e.target.checked)} id="log-pinned" />
            <label htmlFor="log-pinned" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>Pin this entry to top</label>
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>{saving ? 'Saving...' : submitLabel}</button>
        </form>
      </div>
    </div>
  );
}
