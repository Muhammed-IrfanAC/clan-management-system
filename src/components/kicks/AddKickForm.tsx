'use client';

import { useState } from 'react';
import { UserX } from 'lucide-react';
import { useKickListStore } from '@/lib/stores/kickListStore';

// Add any account by tag — including one ClanOps has never synced (kicked before it existed); the
// API then looks the tag up in the CoC API. Form state is local; the store owns the list.
export default function AddKickForm() {
  const adding = useKickListStore((s) => s.adding);
  const addKick = useKickListStore((s) => s.addKick);
  const setToast = useKickListStore((s) => s.setToast);

  const [tag, setTag] = useState('');
  const [comment, setComment] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tag.trim()) return;
    const result = await addKick(tag, comment);
    if (result.ok) {
      setTag('');
      setComment('');
      setToast({ type: 'success', message: `${result.entry.name} added to the kick list.` });
    } else {
      setToast({ type: 'error', message: result.error });
    }
  }

  return (
    <form className="card" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <UserX size={18} className="text-cta" /> Add by tag
      </h3>
      <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>For any account, including ones kicked before ClanOps tracked them.</p>
      <input className="input" placeholder="#PLAYERTAG" value={tag} onChange={(e) => setTag(e.target.value)} autoComplete="off" spellCheck={false} />
      <textarea className="input" rows={2} style={{ resize: 'vertical' }} placeholder="Reason (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={adding || !tag.trim()} style={{ alignSelf: 'flex-start' }}>
        {adding ? 'Adding...' : 'Add to kick list'}
      </button>
    </form>
  );
}
