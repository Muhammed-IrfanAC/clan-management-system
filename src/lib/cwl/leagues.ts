import type { CWLLeague } from '@/types/database';

/**
 * Clash of Clans Ranked-Battle league tiers (the October 2025 "Ranked" revamp).
 *
 * This table is a verbatim transcription of the official `/leaguetiers` endpoint: 37 tiers,
 * ids 105000000–105000036, ordered lowest → highest. Every MAJOR tier has exactly three
 * sub-divisions — a globally-numbered "League N" pair-of-three for Skeleton…Electro, then
 * Legend III / II / I at the top:
 *
 *   105000000  Unranked
 *   105000001  Skeleton League 1    …  105000003  Skeleton League 3
 *   105000004  Barbarian League 4   …  105000033  Electro League 33
 *   105000034  Legend III   105000035  Legend II   105000036  Legend I
 *
 * Because the ids are contiguous and ascend with strength, `id - 105000000` is a clean 0–36
 * ORDINAL, and that ordinal is the only thing the eligibility gate and the strength comparator
 * ever need. An earlier version of this module collapsed the scale to the 12 major tiers, which
 * meant a leader could only say "Dragon+" and never "Dragon 29+" — the sub-division is exactly
 * the granularity that separates a fringe CWL body from a real one, so the full scale is kept.
 *
 * IMPORTANT: this is the `leagueTier` field on a player/member — NOT the legacy trophy `league`
 * field (Bronze…Titan…Legend, ids 29000xxx), which is a different scale that only shares the name
 * "Legend". Sync stores `member.leagueTier.id` and `.name`; see normalizeLeagueTier below.
 *
 * Pure/data-only so it is safe to import from both client components and the allocation engine.
 */

/** Base id of the Ranked tier scale; ordinal = id - LEAGUE_TIER_ID_BASE. */
export const LEAGUE_TIER_ID_BASE = 105000000;

/** Ordinal of the "Unranked" tier — a real, matched tier that still sorts below every league. */
export const UNRANKED_TIER = 0;

/** The highest ordinal on the scale (Legend I). */
export const MAX_LEAGUE_TIER = 36;

/** One tier on the Ranked scale. `ordinal` is the sort key and the value we persist in rules. */
export interface CWLLeagueTier {
  ordinal: number; // 0–36
  id: number; // official API id (105000000 + ordinal)
  name: string; // exact API name, e.g. 'Dragon League 29'
  major: CWLLeague | null; // grouping tier; null only for Unranked
  label: string; // compact display, e.g. 'Dragon 29', 'Legend III', 'Unranked'
}

const T = (ordinal: number, name: string, major: CWLLeague | null, label: string): CWLLeagueTier => ({
  ordinal,
  id: LEAGUE_TIER_ID_BASE + ordinal,
  name,
  major,
  label,
});

/** Every Ranked tier, lowest → highest. Index === ordinal. */
export const CWL_LEAGUE_TIERS: CWLLeagueTier[] = [
  T(0, 'Unranked', null, 'Unranked'),
  T(1, 'Skeleton League 1', 'skeleton', 'Skeleton 1'),
  T(2, 'Skeleton League 2', 'skeleton', 'Skeleton 2'),
  T(3, 'Skeleton League 3', 'skeleton', 'Skeleton 3'),
  T(4, 'Barbarian League 4', 'barbarian', 'Barbarian 4'),
  T(5, 'Barbarian League 5', 'barbarian', 'Barbarian 5'),
  T(6, 'Barbarian League 6', 'barbarian', 'Barbarian 6'),
  T(7, 'Archer League 7', 'archer', 'Archer 7'),
  T(8, 'Archer League 8', 'archer', 'Archer 8'),
  T(9, 'Archer League 9', 'archer', 'Archer 9'),
  T(10, 'Wizard League 10', 'wizard', 'Wizard 10'),
  T(11, 'Wizard League 11', 'wizard', 'Wizard 11'),
  T(12, 'Wizard League 12', 'wizard', 'Wizard 12'),
  T(13, 'Valkyrie League 13', 'valkyrie', 'Valkyrie 13'),
  T(14, 'Valkyrie League 14', 'valkyrie', 'Valkyrie 14'),
  T(15, 'Valkyrie League 15', 'valkyrie', 'Valkyrie 15'),
  T(16, 'Witch League 16', 'witch', 'Witch 16'),
  T(17, 'Witch League 17', 'witch', 'Witch 17'),
  T(18, 'Witch League 18', 'witch', 'Witch 18'),
  T(19, 'Golem League 19', 'golem', 'Golem 19'),
  T(20, 'Golem League 20', 'golem', 'Golem 20'),
  T(21, 'Golem League 21', 'golem', 'Golem 21'),
  T(22, 'P.E.K.K.A League 22', 'pekka', 'P.E.K.K.A 22'),
  T(23, 'P.E.K.K.A League 23', 'pekka', 'P.E.K.K.A 23'),
  T(24, 'P.E.K.K.A League 24', 'pekka', 'P.E.K.K.A 24'),
  T(25, 'Titan League 25', 'titan', 'Titan 25'),
  T(26, 'Titan League 26', 'titan', 'Titan 26'),
  T(27, 'Titan League 27', 'titan', 'Titan 27'),
  T(28, 'Dragon League 28', 'dragon', 'Dragon 28'),
  T(29, 'Dragon League 29', 'dragon', 'Dragon 29'),
  T(30, 'Dragon League 30', 'dragon', 'Dragon 30'),
  T(31, 'Electro League 31', 'electro', 'Electro 31'),
  T(32, 'Electro League 32', 'electro', 'Electro 32'),
  T(33, 'Electro League 33', 'electro', 'Electro 33'),
  T(34, 'Legend III', 'legend', 'Legend III'),
  T(35, 'Legend II', 'legend', 'Legend II'),
  T(36, 'Legend I', 'legend', 'Legend I'),
];

/** The 12 major tiers with their three sub-divisions, for grouped pickers (<optgroup>). */
export const CWL_LEAGUE_MAJORS: { key: CWLLeague; label: string; tiers: CWLLeagueTier[] }[] = (() => {
  const labels: Record<CWLLeague, string> = {
    skeleton: 'Skeleton',
    barbarian: 'Barbarian',
    archer: 'Archer',
    wizard: 'Wizard',
    valkyrie: 'Valkyrie',
    witch: 'Witch',
    golem: 'Golem',
    pekka: 'P.E.K.K.A',
    titan: 'Titan',
    dragon: 'Dragon',
    electro: 'Electro',
    legend: 'Legend',
  };
  const groups: { key: CWLLeague; label: string; tiers: CWLLeagueTier[] }[] = [];
  for (const tier of CWL_LEAGUE_TIERS) {
    if (!tier.major) continue;
    const last = groups[groups.length - 1];
    if (last && last.key === tier.major) last.tiers.push(tier);
    else groups.push({ key: tier.major, label: labels[tier.major], tiers: [tier] });
  }
  return groups;
})();

const BY_ID = new Map(CWL_LEAGUE_TIERS.map((t) => [t.id, t]));
const BY_NAME = new Map(CWL_LEAGUE_TIERS.map((t) => [t.name.toLowerCase(), t]));

/** The lowest ordinal belonging to each major tier — the floor "Dragon+" used to mean. */
const MAJOR_FLOOR = new Map<CWLLeague, number>(
  CWL_LEAGUE_MAJORS.map((g) => [g.key, g.tiers[0].ordinal]),
);

/** The lowest tier of a major group, i.e. what a legacy "<major>+" rule meant. */
export function majorFloorTier(major: CWLLeague): number {
  return MAJOR_FLOOR.get(major) ?? UNRANKED_TIER;
}

/** Look up a tier by its ordinal (null/out-of-range → undefined). */
export function tierAt(ordinal: number | null | undefined): CWLLeagueTier | undefined {
  return ordinal == null ? undefined : CWL_LEAGUE_TIERS[ordinal];
}

/**
 * Rank of a tier for comparison. An unknown/absent tier sorts below every real tier — including
 * below Unranked (0), which is itself a matched value meaning "has no ranked standing".
 */
export function tierOrder(ordinal: number | null): number {
  return ordinal == null ? -1 : ordinal;
}

/** Human label for a tier ordinal ('—' when unknown). */
export function tierLabel(ordinal: number | null): string {
  return tierAt(ordinal)?.label ?? '—';
}

/** Label for an eligibility FLOOR, e.g. 'Dragon 29+' / 'any league'. */
export function tierFloorLabel(ordinal: number | null): string {
  const tier = tierAt(ordinal);
  return tier ? `${tier.label}+` : 'any league';
}

// Distinctive keyword per major tier, used only as a fallback when an exact name/id match fails
// (an API rename, or a row synced before this table was written). The Ranked tier names are single
// words with no overlap (unlike the trophy scale), so plain substring matching is unambiguous.
// Legacy trophy-only names (Bronze/Silver/Gold/Crystal/Master/Champion) fall through to null.
const MAJOR_MATCHERS: { needle: string; major: CWLLeague }[] = [
  { needle: 'skeleton', major: 'skeleton' },
  { needle: 'barbarian', major: 'barbarian' },
  { needle: 'archer', major: 'archer' },
  { needle: 'wizard', major: 'wizard' },
  { needle: 'valkyrie', major: 'valkyrie' },
  { needle: 'witch', major: 'witch' },
  { needle: 'golem', major: 'golem' },
  { needle: 'p.e.k.k.a', major: 'pekka' },
  { needle: 'pekka', major: 'pekka' },
  { needle: 'titan', major: 'titan' },
  { needle: 'dragon', major: 'dragon' },
  { needle: 'electro', major: 'electro' },
  { needle: 'legend', major: 'legend' },
];

/**
 * Resolve an account's stored Ranked standing to a tier ORDINAL (0–36), or null if it isn't on the
 * Ranked scale at all. Resolution order, most to least authoritative:
 *   1. the persisted `leagueTier.id` (exact, survives any future renaming),
 *   2. an exact name match against the official table,
 *   3. a major-tier keyword match, degraded to that major's LOWEST sub-division — the safe read,
 *      since assuming the floor can only ever under-rate a player, never over-rate them into a
 *      clan they don't qualify for.
 * Isolated here so a future API change only touches this function.
 */
export function normalizeLeagueTier(
  rawName: string | null | undefined,
  tierId?: number | null,
): number | null {
  if (tierId != null) {
    const byId = BY_ID.get(tierId);
    if (byId) return byId.ordinal;
  }
  if (!rawName) return null;
  const s = rawName.trim().toLowerCase();
  const exact = BY_NAME.get(s);
  if (exact) return exact.ordinal;
  if (s === 'unranked') return UNRANKED_TIER;
  for (const m of MAJOR_MATCHERS) {
    if (s.includes(m.needle)) return majorFloorTier(m.major);
  }
  return null;
}
