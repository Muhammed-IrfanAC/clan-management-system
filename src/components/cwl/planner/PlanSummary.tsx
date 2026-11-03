'use client';

import { useMemo } from 'react';
import { usePlan } from './usePlan';
import { useCwlPlannerStore } from '@/lib/stores/cwlPlannerStore';
import { livePendingStars } from '@/lib/cwl/plannerInput';

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card" style={{ padding: 'var(--space-md)', flex: '1 1 160px', minWidth: 0 }}>
      <div style={{ fontSize: '0.66rem', textTransform: 'uppercase', color: 'var(--color-muted)', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{value}</div>
      {hint && <div className="text-muted" style={{ fontSize: '0.7rem', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

/** The goal, as numbers: how many reach 8★ under this plan, and what it is worth in clan stars. */
export default function PlanSummary() {
  const plan = usePlan();
  const groupClans = useCwlPlannerStore((s) => s.groupClans);
  const roster = useCwlPlannerStore((s) => s.roster);
  const rounds = useCwlPlannerStore((s) => s.rounds);
  const members = useCwlPlannerStore((s) => s.members);

  // The war still being fought: what its remaining attacks are expected to bring. Already counted in
  // every projection below — shown so a leader planning early can see how much is still in the air.
  const live = useMemo(() => {
    const pending = livePendingStars({ roster, rounds, members });
    const round = rounds.find((r) => r.state === 'inWar');
    if (!round) return null;
    let stars = 0;
    let left = 0;
    for (const [key, e] of pending) {
      if (!key.startsWith(`${round.id}:`)) continue;
      stars += e;
      left++;
    }
    return { roundNumber: round.round_number, stars, left };
  }, [roster, rounds, members]);

  const eligible = plan.accounts.filter((a) => a.status !== 'excluded');
  const clean = eligible.filter((a) => !a.ruleBreaker);
  const rb = eligible.filter((a) => a.ruleBreaker);
  const openWars = plan.rounds.length;
  const knownWars = plan.rounds.filter((r) => r.enemyKnown).length;

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-sm)' }}>
      <Tile
        label="Reach 8★"
        value={`${plan.totals.reachedClean} / ${clean.length}`}
        hint={rb.length ? `rule breakers ${plan.totals.reachedRuleBreakers} / ${rb.length}` : 'clean accounts'}
      />
      <Tile
        label="Expected clan stars"
        value={plan.totals.expectedClanStars.toFixed(0)}
        hint={`over the ${openWars} war${openWars === 1 ? '' : 's'} still to plan`}
      />
      {live && (
        <Tile
          label={`War ${live.roundNumber} in progress`}
          value={live.left ? `~${live.stars.toFixed(1)}★` : 'all done'}
          hint={live.left ? `still expected from ${live.left} attack${live.left === 1 ? '' : 's'} left` : 'every attack has been made'}
        />
      )}
      <Tile label="War size" value={`${plan.warSize}v${plan.warSize}`} hint={`${eligible.length} accounts available`} />
      <Tile
        label="Opponents"
        value={groupClans.length ? `${knownWars} known` : 'not drawn'}
        hint={groupClans.length ? 'later wars use the clans still to face' : 'planned as mirror-strength until CWL starts'}
      />
    </div>
  );
}
