'use client';

import { useState } from 'react';
import { Ban, X } from 'lucide-react';
import { useKickListStore } from '@/lib/stores/kickListStore';
import type { KickListEntry } from '@/lib/kicks/watch';

// Confirm putting one known account on the kick list, with an optional reason. Shared by the
// kick list's recent-departures panel and the member dossier, so it reports success through
// `onDone` and leaves the toast to whichever page opened it. Errors stay inline: the modal is
// still open, and the leader can correct and retry.
export default function MarkKickedModal({
  account,
  onClose,
  onDone,
}: {
  account: { tag: string; name: string };
  onClose: () => void;
  onDone: (entry: KickListEntry) => void;
}) {
  const adding = useKickListStore((s) => s.adding);
  const addKick = useKickListStore((s) => s.addKick);

  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const result = await addKick(account.tag, comment);
    if (result.ok) onDone(result.entry);
    else setError(result.error);
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ padding: 0 }}>
        <div style={{ padding: 'var(--space-lg)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
              <Ban size={18} color="var(--color-danger)" /> Mark as kicked
            </h2>
            <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>{account.name} ({account.tag})</p>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: 'var(--color-muted)' }} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 'var(--space-lg)' }}>
          <p className="text-muted" style={{ fontSize: '0.8rem', margin: '0 0 var(--space-md)' }}>
            If this account — or any other account linked to the same person — joins a family clan, leadership gets a Discord alert.
          </p>
          <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: '700', textTransform: 'uppercase', color: 'var(--color-muted)', marginBottom: '8px' }}>
            Reason (optional)
          </label>
          <textarea
            autoFocus
            className="input"
            rows={3}
            style={{ resize: 'vertical' }}
            placeholder="Why were they kicked?"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {error && <p className="text-danger" style={{ fontSize: '0.8rem', margin: 'var(--space-sm) 0 0' }}>{error}</p>}
        </div>

        <div style={{ padding: 'var(--space-lg)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-md)' }}>
          <button className="btn btn-outline" style={{ border: 'none' }} onClick={onClose} disabled={adding}>Cancel</button>
          <button className="btn" style={{ background: 'var(--color-danger)', color: '#fff', minWidth: '140px' }} disabled={adding} onClick={handleSubmit}>
            {adding ? 'Adding...' : 'Add to kick list'}
          </button>
        </div>
      </div>
    </div>
  );
}
