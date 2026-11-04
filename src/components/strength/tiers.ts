import type { SkillTier } from '@/lib/cwl/attackModel';
import { GOAT_COUNT, STRONG_SHARE, WEAK_SHARE } from '@/lib/cwl/familyStrength';

/**
 * How a strength label looks and reads, shared by the Strength page and the CWL planner so both say
 * the same thing. Labels come from the family ranking (familyStrength.ts); nothing is planned from them.
 */
export const TIER_COLOR: Record<SkillTier, string> = {
  goat: 'var(--color-danger)',
  strong: 'var(--color-cta)',
  medium: 'var(--color-text)',
  weak: 'var(--color-warning)',
};

export const TIER_ORDER: SkillTier[] = ['goat', 'strong', 'medium', 'weak'];

export const TIER_MEANING: Record<SkillTier, string> = {
  goat: `the family's top ${GOAT_COUNT}`,
  strong: `the rest of the top ${Math.round(STRONG_SHARE * 100)}%`,
  medium: 'the middle',
  weak: `the bottom ${Math.round(WEAK_SHARE * 100)}%`,
};

export const pct = (p: number) => `${Math.round(p * 100)}%`;

/** A league share as "top 4.4%" — two decimals below 1%, where the leagues are thin. */
export function topShare(share: number): string {
  return `top ${(share * 100).toFixed(share < 0.01 ? 2 : 1)}%`;
}
