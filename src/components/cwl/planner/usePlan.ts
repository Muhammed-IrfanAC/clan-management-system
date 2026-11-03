'use client';

import { useMemo } from 'react';
import { useCwlPlannerStore } from '@/lib/stores/cwlPlannerStore';
import { buildPlannerInput, type PlannerSource } from '@/lib/cwl/plannerInput';
import { planSeason, type SeasonPlan } from '@/lib/cwl/planner';

/**
 * Plan for a set of source rows, remembering the last result.
 *
 * Several components read the plan, and a 30v30 plan takes a few hundred milliseconds, so it is
 * cached against the identity of its inputs: every component gets the same object, and it is only
 * recomputed when a store mutation replaces one of the rows it was built from.
 */
const planFor = (() => {
  let last: { src: PlannerSource; plan: SeasonPlan } | null = null;
  return (src: PlannerSource): SeasonPlan => {
    const keys = Object.keys(src) as (keyof PlannerSource)[];
    if (last && keys.every((k) => last!.src[k] === src[k])) return last.plan;
    const plan = planSeason(buildPlannerInput(src));
    last = { src, plan };
    return plan;
  };
})();

/** The derived plan for the clan currently loaded in the planner store. */
export function usePlan(): SeasonPlan {
  const warSize = useCwlPlannerStore((s) => s.warSize);
  const roster = useCwlPlannerStore((s) => s.roster);
  const rounds = useCwlPlannerStore((s) => s.rounds);
  const members = useCwlPlannerStore((s) => s.members);
  const overrides = useCwlPlannerStore((s) => s.overrides);
  const flags = useCwlPlannerStore((s) => s.flags);
  const optedOut = useCwlPlannerStore((s) => s.optedOut);
  const groupClans = useCwlPlannerStore((s) => s.groupClans);

  return useMemo(
    () => planFor({ warSize, roster, rounds, members, overrides, flags, optedOut, groupClans }),
    [warSize, roster, rounds, members, overrides, flags, optedOut, groupClans],
  );
}
