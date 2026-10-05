'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Pencil, Trash2, Eye } from 'lucide-react';
import { useKickListStore } from '@/lib/stores/kickListStore';
import { useClan } from '@/lib/ClanContext';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import type { KickListEntry } from '@/lib/kicks/watch';

// One kicked account: who, when, by whom and why, which other accounts of the same person this puts
// on watch, and — in red — whether any of them is in a family clan right now. Comment editing and the
// delete confirmation are UI-local; the store applies the result.
export default function KickEntryCard({ entry }: { entry: KickListEntry }) {
  const savingTag = useKickListStore((s) => s.savingTag);
  const removingTag = useKickListStore((s) => s.removingTag);
  const saveComment = useKickListStore((s) => s.saveComment);
  const removeKick = useKickListStore((s) => s.removeKick);
  const setToast = useKickListStore((s) => s.setToast);
  const { clans } = useClan();
  const clanName = (id: string | null) => clans.find((c) => c.id === id)?.display_name ?? null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [confirming, setConfirming] = useState(false);

  const inFamily = entry.present.find((p) => !p.isAlt);
  const kickedFrom = clanName(entry.kickedFromClanId);

  async function handleSave() {
    const result = await saveComment(entry.tag, draft);
    if (result.ok) {
      setEditing(false);
      setToast({ type: 'success', message: 'Comment saved.' });
    } else {
      setToast({ type: 'error', message: result.error });
    }
  }

  async function handleRemove() {
    const result = await removeKick(entry.tag);
    setConfirming(false);
    setToast(result.ok
      ? { type: 'success', message: `${entry.name} removed from the kick list.` }
      : { type: 'error', message: result.error || 'Failed to remove the entry' });
  }

  // The confirm modal renders OUTSIDE the .card: its hover transform would otherwise become the
  // containing block for the overlay's position: fixed and trap it inside the card.
  return (
    <>
    <div className="card" style={{ cursor: 'default', ...(entry.present.length ? { border: '1px solid rgba(239,68,68,0.4)' } : {}) }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{entry.name}</h3>
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>{entry.tag}{entry.thLevel ? ` • TH${entry.thLevel}` : ''}</span>
            {inFamily ? (
              <span style={{ fontSize: '0.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: '10px', background: 'var(--color-danger)', color: '#fff' }}>
                IN {(clanName(inFamily.clanId) ?? 'A FAMILY CLAN').toUpperCase()}
              </span>
            ) : (
              <span style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: '10px', background: 'rgba(255,255,255,0.06)', color: 'var(--color-muted)' }}>not in the family</span>
            )}
          </div>
          <p className="text-muted" style={{ fontSize: '0.75rem', margin: '4px 0 0' }}>
            Kicked {new Date(entry.kickedAt).toLocaleDateString()}{kickedFrom ? ` from ${kickedFrom}` : ''} by {entry.kickedByName}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'flex-start' }}>
          {!editing && (
            <button onClick={() => { setDraft(entry.comment ?? ''); setEditing(true); }} style={{ background: 'transparent', color: 'var(--color-muted)', cursor: 'pointer' }} title="Edit comment" aria-label="Edit comment">
              <Pencil size={15} />
            </button>
          )}
          <button onClick={() => setConfirming(true)} style={{ background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }} title="Remove from kick list" aria-label="Remove from kick list">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-md)' }}>
        {editing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <textarea
              autoFocus
              className="input"
              rows={2}
              style={{ resize: 'vertical', fontSize: '0.85rem' }}
              value={draft}
              placeholder="Why were they kicked?"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false); }}
            />
            <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
              <button onClick={handleSave} disabled={savingTag === entry.tag} className="btn btn-primary" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>
                {savingTag === entry.tag ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} disabled={savingTag === entry.tag} className="btn btn-outline" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}>Cancel</button>
            </div>
          </div>
        ) : entry.comment ? (
          <p style={{ fontSize: '0.85rem', margin: 0, whiteSpace: 'pre-wrap' }}>{entry.comment}</p>
        ) : (
          <p className="text-muted" style={{ fontSize: '0.8rem', margin: 0, fontStyle: 'italic' }}>No reason recorded.</p>
        )}
      </div>

      {(entry.personId || entry.alts.length > 0) && (
        <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-sm)', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '0.75rem' }}>
          <div className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <Eye size={13} />
            {entry.personId && (
              <Link href={`/dashboard/members/${entry.personId}`} style={{ color: 'var(--color-cta)' }}>{entry.personName ?? 'Profile'}</Link>
            )}
            {entry.alts.length > 0 ? <span>— also watching:</span> : <span>— no other accounts linked</span>}
            {entry.alts.map((alt) => (
              <span
                key={alt.tag}
                style={{
                  padding: '1px 6px', borderRadius: '4px',
                  background: alt.status === 'active' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)',
                  color: alt.status === 'active' ? 'var(--color-danger)' : undefined,
                }}
                title={alt.tag}
              >
                {alt.name}{alt.status === 'active' ? ` · in ${clanName(alt.clanId) ?? 'a family clan'}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>

      <ConfirmationModal
        isOpen={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={handleRemove}
        title="Remove from kick list"
        message={`Stop watching ${entry.name}${entry.alts.length ? ` and their ${entry.alts.length} other account${entry.alts.length === 1 ? '' : 's'}` : ''}? Do this if they are welcome back.`}
        confirmText="Remove"
        isLoading={removingTag === entry.tag}
      />
    </>
  );
}
