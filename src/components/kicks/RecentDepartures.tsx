'use client';

import { useState } from 'react';
import { DoorOpen } from 'lucide-react';
import { useKickListStore } from '@/lib/stores/kickListStore';
import { useClan } from '@/lib/ClanContext';
import { RECENT_DEPARTURE_DAYS, type DepartureEntry } from '@/lib/kicks/watch';
import MarkKickedModal from './MarkKickedModal';

function sinceLabel(iso: string): string {
  const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// The CoC API cannot tell a kick from a leave, so this offers everyone who left a family clan in the
// last couple of days as a one-click "that was a kick". Members who hopped to another family clan
// are active again and never appear.
export default function RecentDepartures() {
  const departures = useKickListStore((s) => s.departures);
  const setToast = useKickListStore((s) => s.setToast);
  const { clans } = useClan();
  const clanName = (id: string | null) => clans.find((c) => c.id === id)?.display_name ?? 'a family clan';

  const [marking, setMarking] = useState<DepartureEntry | null>(null);

  // The modal renders OUTSIDE the .card: its hover transform would otherwise become the containing
  // block for the overlay's position: fixed and trap it inside the card.
  return (
    <>
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <DoorOpen size={18} className="text-cta" /> Left in the last {RECENT_DEPARTURE_DAYS} days
      </h3>
      <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>Was one of these a kick? Leadership alts are not shown.</p>

      {departures.length === 0 ? (
        <p className="text-muted" style={{ fontSize: '0.8rem', margin: 'var(--space-sm) 0 0' }}>Nobody has left a family clan recently.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', maxHeight: '260px', overflowY: 'auto' }}>
          {departures.map((d) => (
            <div key={d.tag} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-sm)', padding: 'var(--space-sm) var(--space-md)', background: 'var(--color-background)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
                  {d.name}
                  {d.personName && d.personName !== d.name && <span className="text-muted" style={{ fontWeight: 400 }}> · {d.personName}</span>}
                </div>
                <p className="text-muted" style={{ fontSize: '0.7rem', margin: '2px 0 0' }}>
                  {d.tag}{d.thLevel ? ` • TH${d.thLevel}` : ''} • left {clanName(d.clanId)} {sinceLabel(d.lastSeenAt)}
                </p>
              </div>
              <button className="btn btn-outline" style={{ padding: '0.35rem 0.7rem', fontSize: '0.72rem', color: 'var(--color-danger)', flexShrink: 0 }} onClick={() => setMarking(d)}>
                Mark as kicked
              </button>
            </div>
          ))}
        </div>
      )}
    </div>

      {marking && (
        <MarkKickedModal
          account={{ tag: marking.tag, name: marking.name }}
          onClose={() => setMarking(null)}
          onDone={(entry) => {
            setMarking(null);
            setToast({ type: 'success', message: `${entry.name} added to the kick list.` });
          }}
        />
      )}
    </>
  );
}
