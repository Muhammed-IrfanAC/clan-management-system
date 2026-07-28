'use client';

import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import { useCWLStore } from '@/lib/stores/cwlStore';
import { useClanName } from './useClanName';

/**
 * Required in-game transfers with a confirm checkbox. The move itself is manual (in-game); ticking
 * records that a leader completed it. This is deliberately the "your turn to act in-game" surface.
 *
 * Reads the store directly: ticking one row splices that row (and its roster card) rather than
 * reloading the season, so the list no longer flashes on every checkbox.
 */
export default function TransfersPanel() {
  const transfers = useCWLStore((s) => s.transfers);
  const savingTransferId = useCWLStore((s) => s.savingTransferId);
  const toggleTransfer = useCWLStore((s) => s.toggleTransfer);
  const clanName = useClanName();

  const pending = transfers.filter((t) => t.status !== 'done').length;

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', marginBottom: '4px' }}>
        <ArrowRightLeft size={18} className="text-warning" />
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Required Transfers</h3>
        {pending > 0 && (
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-warning)', background: 'rgba(245,158,11,0.12)', borderRadius: 999, padding: '2px 8px' }}>{pending} pending</span>
        )}
      </div>
      <p className="text-muted" style={{ fontSize: '0.75rem', margin: '0 0 var(--space-md)' }}>
        Move each account in-game, then tick it off. Nothing here changes the game — it only tracks your manual moves.
      </p>

      {transfers.length === 0 ? (
        <p className="text-muted" style={{ fontSize: '0.85rem' }}>No transfers required — every account is already in its recommended clan.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
          {transfers.map((t) => {
            const done = t.status === 'done';
            const busy = savingTransferId === t.id;
            return (
              <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: '7px 8px', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)', cursor: busy ? 'default' : 'pointer', opacity: done ? 0.6 : 1 }}>
                <input type="checkbox" checked={done} disabled={busy} onChange={(e) => toggleTransfer(t.id, e.target.checked)} />
                <span style={{ flex: 1, fontSize: '0.85rem', textDecoration: done ? 'line-through' : 'none' }}>
                  {t.playerName}
                  {/* The account moves, but a leader needs to know whose account it is to go ask them. */}
                  {t.personName !== t.playerName && (
                    <span className="text-muted" style={{ fontSize: '0.7rem' }}> · {t.personName}</span>
                  )}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                  {clanName(t.fromClanId)} <ArrowRight size={12} /> <span style={{ color: 'var(--color-text)' }}>{clanName(t.toClanId)}</span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
