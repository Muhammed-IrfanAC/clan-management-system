'use client';

import { ArrowRight, ArrowRightLeft } from 'lucide-react';
import { useCWLStore } from '@/lib/stores/cwlStore';
import { useClanName } from './useClanName';

/**
 * Required in-game transfers. The move itself is manual (in-game), but the roster sync watches every
 * family clan, so a completed move ticks itself off within a sync cycle and a player who moves back
 * out re-opens (see `cwl/transferDetect.ts`). The checkbox stays as the manual override — for the
 * gap before the next sync, and for a destination the sync cannot observe.
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
        Ticks itself off once the sync sees the account in its new clan. Tick manually to record a move early —
        nothing here changes the game.
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
