'use client';

import { ShieldAlert } from 'lucide-react';
import { useKickListStore } from '@/lib/stores/kickListStore';
import { useClan } from '@/lib/ClanContext';

// The alarm, on the page itself: every watched account that is in a family clan right now. The
// Discord alert fires once per join; this stays up for as long as they are actually there. Hidden
// when nobody is.
export default function KickedPresenceBanner() {
  const entries = useKickListStore((s) => s.entries);
  const { clans } = useClan();
  const clanName = (id: string | null) => clans.find((c) => c.id === id)?.display_name ?? 'a family clan';

  const present = entries.flatMap((e) => e.present.map((p) => ({ ...p, entry: e })));
  if (present.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 'var(--space-xl)', border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.05)' }}>
      <h3 style={{ margin: '0 0 var(--space-md)', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', color: 'var(--color-danger)' }}>
        <ShieldAlert size={18} /> {present.length} kicked {present.length === 1 ? 'account is' : 'accounts are'} in the family right now
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)', fontSize: '0.85rem' }}>
        {present.map((p) => (
          <div key={p.tag}>
            <strong>{p.name}</strong> <span className="text-muted">{p.tag}</span> is in <strong>{clanName(p.clanId)}</strong>
            {p.isAlt && <span className="text-muted"> — alt of {p.entry.personName ?? p.entry.name}, who was kicked</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
