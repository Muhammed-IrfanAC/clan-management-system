'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, ListOrdered, RefreshCw } from 'lucide-react';
import { useCWLStore } from '@/lib/stores/cwlStore';
import ConfirmationModal from '@/components/ui/ConfirmationModal';
import { useClanName } from './useClanName';

/**
 * The season's clan FILL ORDER — item 3's control surface.
 *
 * The allocation engine waterfalls down this list: the clan at the top is filled first and takes the
 * strongest eligible accounts, and everything it can't hold spills to the next clan, and so on. That
 * ordering is a leadership decision (which clan is the flagship this month, which are feeders) and
 * changes month to month, so it is arranged here rather than hard-coded anywhere.
 *
 * Reordering saves immediately but does NOT touch the roster — regenerating replaces every
 * allocation and discards hand-edits, so it stays a separate, confirmed action.
 */
export default function ClanPriorityPanel() {
  const seasonClans = useCWLStore((s) => s.seasonClans);
  const reorderClans = useCWLStore((s) => s.reorderClans);
  const setWarSize = useCWLStore((s) => s.setWarSize);
  const reallocate = useCWLStore((s) => s.reallocate);
  const savingPriority = useCWLStore((s) => s.savingPriority);
  const savingSeason = useCWLStore((s) => s.savingSeason);
  const clanName = useClanName();

  const [confirmReallocate, setConfirmReallocate] = useState(false);

  const move = (index: number, delta: number) => {
    const next = seasonClans.map((c) => c.clanId);
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    reorderClans(next);
  };

  if (seasonClans.length === 0) return null;

  return (
    <div className="card" style={{ padding: 'var(--space-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
          <ListOrdered size={18} className="text-cta" />
          <h3 style={{ fontSize: '1rem', margin: 0 }}>Clan Fill Order</h3>
          {savingPriority && <span className="text-muted" style={{ fontSize: '0.7rem' }}>Saving…</span>}
        </div>
        <button
          className="btn btn-outline"
          style={{ padding: '6px 12px', fontSize: '0.8rem' }}
          disabled={savingSeason || savingPriority}
          onClick={() => setConfirmReallocate(true)}
        >
          <RefreshCw size={14} /> Re-allocate roster
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: '0.75rem', margin: '0 0 var(--space-md)' }}>
        Filled top to bottom: each clan takes the strongest accounts up to its lineup <em>and</em> its
        bench, and only the surplus spills to the next.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
        {seasonClans.map((sc, i) => (
          <div
            key={sc.clanId}
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', padding: '7px 8px', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)' }}
          >
            <span className="text-muted" style={{ fontSize: '0.7rem', fontVariantNumeric: 'tabular-nums', width: 20 }}>#{i + 1}</span>
            <span style={{ flex: 1, fontSize: '0.85rem', fontWeight: i === 0 ? 700 : 400 }}>
              {clanName(sc.clanId)}
              {i === 0 && <span className="text-muted" style={{ fontSize: '0.68rem', fontWeight: 400 }}> · filled first</span>}
            </span>
            <select
              className="input"
              aria-label={`War size for ${clanName(sc.clanId)}`}
              style={{ width: 'auto', padding: '4px 8px', fontSize: '0.78rem' }}
              value={sc.warSize}
              disabled={savingPriority}
              onChange={(e) => setWarSize(sc.clanId, parseInt(e.target.value, 10))}
            >
              <option value={15}>15v15</option>
              <option value={30}>30v30</option>
            </select>
            <div style={{ display: 'flex', gap: 2 }}>
              <button
                aria-label={`Move ${clanName(sc.clanId)} up`}
                disabled={i === 0 || savingPriority}
                onClick={() => move(i, -1)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: i === 0 ? 'default' : 'pointer', opacity: i === 0 ? 0.3 : 1, display: 'flex', padding: 3 }}
              >
                <ArrowUp size={15} />
              </button>
              <button
                aria-label={`Move ${clanName(sc.clanId)} down`}
                disabled={i === seasonClans.length - 1 || savingPriority}
                onClick={() => move(i, 1)}
                style={{ background: 'transparent', border: 'none', color: 'var(--color-muted)', cursor: i === seasonClans.length - 1 ? 'default' : 'pointer', opacity: i === seasonClans.length - 1 ? 0.3 : 1, display: 'flex', padding: 3 }}
              >
                <ArrowDown size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmationModal
        isOpen={confirmReallocate}
        onClose={() => setConfirmReallocate(false)}
        onConfirm={async () => {
          setConfirmReallocate(false);
          await reallocate();
        }}
        title="Regenerate the whole roster?"
        message="The engine will re-run against the current fill order, this season's frozen eligibility rules and today's live member data. Every allocation and pending transfer is replaced — any manual moves, benchings or removals you made are lost."
        confirmText="Re-allocate"
        variant="warning"
        isLoading={savingSeason}
      />
    </div>
  );
}
