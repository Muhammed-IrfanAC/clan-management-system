'use client';

import { useClan } from '@/lib/ClanContext';
import { useStrengthStore } from '@/lib/stores/strengthStore';
import { TIER_COLOR, TIER_MEANING, TIER_ORDER } from './tiers';

/** How many accounts of the current view hold each label, and what each label means. */
export default function TierLegend() {
  const accounts = useStrengthStore((s) => s.accounts);
  const { selectedClanId } = useClan();
  const shown = accounts.filter((a) => selectedClanId === 'all' || a.clanId === selectedClanId);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--space-sm)', marginBottom: 'var(--space-md)' }}>
      {TIER_ORDER.map((tier) => (
        <div key={tier} className="card" style={{ padding: 'var(--space-sm) var(--space-md)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: TIER_COLOR[tier], fontWeight: 700, textTransform: 'capitalize' }}>{tier}</span>
            <span style={{ fontSize: '1.3rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{shown.filter((a) => a.tier === tier).length}</span>
          </div>
          <div className="text-muted" style={{ fontSize: '0.72rem' }}>{TIER_MEANING[tier]}</div>
        </div>
      ))}
    </div>
  );
}
