import type { AccountOutlook, BenchReason, SlotReason, UnavailableReason } from '@/lib/cwl/planner';
// Strength labels are shared with the Strength page, so both describe an account the same way.
export { TIER_COLOR, pct } from '@/components/strength/tiers';

/** Shared wording for the planner's reason codes, so every panel says the same thing. */
export const SLOT_REASON: Record<SlotReason, string> = {
  forced_in: 'Forced in for this war',
  chasing: 'Still needs stars for 8★',
  strength: 'Fills the lineup for clan stars',
};

export const BENCH_REASON: Record<BenchReason, string> = {
  target_reached: 'Already at 8★',
  covered_elsewhere: 'Reaches 8★ in other wars',
  not_reachable: 'Cannot reach 8★ in the wars left',
};

export const UNAVAILABLE_REASON: Record<UnavailableReason, string> = {
  forced_out: 'Forced out of this war',
  war_preference: 'Opted out in game (war preference)',
  unavailable: 'Unavailable',
  banned: 'Banned from CWL',
  opted_out: 'Not participating this season',
  unranked: 'Unranked — mark as banned',
};

export const STATUS_LABEL: Record<AccountOutlook['status'], string> = {
  reached: 'Has 8★',
  on_track: 'On track',
  short: 'Short',
  not_planned: 'Not planned',
  excluded: 'Excluded',
};

export function statusColor(status: AccountOutlook['status']): string {
  switch (status) {
    case 'reached':
    case 'on_track':
      return 'var(--color-cta)';
    case 'short':
    case 'not_planned':
      return 'var(--color-warning)';
    default:
      return 'var(--color-muted)';
  }
}
