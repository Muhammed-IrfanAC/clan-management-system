'use client';

import { useMemo } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useCwlPlannerStore } from '@/lib/stores/cwlPlannerStore';
import { lineupSwaps } from '@/lib/cwl/swaps';
import { usePlan } from './usePlan';

/**
 * The in-game edits that turn the lineup that exists now into the planned one for the next war:
 * who goes out, who comes in. See cwl/swaps.ts for what "now" means.
 */
export default function SwapsPanel() {
  const plan = usePlan();
  const rounds = useCwlPlannerStore((s) => s.rounds);
  const members = useCwlPlannerStore((s) => s.members);
  const next = plan.rounds[0];

  const swaps = useMemo(
    () => (next ? lineupSwaps({ planned: next.lineup, nextRoundNumber: next.roundNumber, rounds, members }) : null),
    [next, rounds, members],
  );
  if (!next || !swaps) return null;

  const from =
    swaps.fromRound == null
      ? null
      : swaps.fromCurrentPrep
        ? `the war ${swaps.fromRound} lineup currently set in game`
        : `the war ${swaps.fromRound} lineup`;

  return (
    <div className="card" style={{ padding: 'var(--space-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Swaps for war {next.roundNumber}</h3>
        {from && (
          <span className="text-muted" style={{ fontSize: '0.75rem' }}>
            {swaps.out.length + swaps.in.length === 0 ? 'No changes' : `${Math.max(swaps.out.length, swaps.in.length)} swap${Math.max(swaps.out.length, swaps.in.length) === 1 ? '' : 's'}`} from {from}
          </span>
        )}
      </div>

      {swaps.fromRound == null ? (
        <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>No lineup to swap from yet — the planned lineup above is the whole lineup.</p>
      ) : swaps.out.length + swaps.in.length === 0 ? (
        <p className="text-muted" style={{ fontSize: '0.82rem', margin: 0 }}>The planned lineup is the one already in game — nothing to change.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-md)' }}>
          <SwapList title="Goes out" icon={<ArrowDown size={14} />} color="var(--color-danger)" names={swaps.out.map((s) => s.name)} />
          <SwapList title="Comes in" icon={<ArrowUp size={14} />} color="var(--color-cta)" names={swaps.in.map((s) => s.name)} />
        </div>
      )}
    </div>
  );
}

function SwapList({ title, icon, color, names }: { title: string; icon: React.ReactNode; color: string; names: string[] }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', textTransform: 'uppercase', color, marginBottom: 4 }}>
        {icon} {title} ({names.length})
      </div>
      {names.length === 0 ? (
        <div className="text-muted" style={{ fontSize: '0.8rem' }}>—</div>
      ) : (
        names.map((n, i) => (
          <div key={`${n}-${i}`} style={{ fontSize: '0.82rem', padding: '2px 0' }}>{n}</div>
        ))
      )}
    </div>
  );
}
