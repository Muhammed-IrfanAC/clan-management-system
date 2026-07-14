import type { CWLLeague } from '@/types/database';

/**
 * Clash of Clans Ranked-Battle league tiers (the October 2025 "Ranked" revamp), ordered lowest →
 * highest. These are the MAJOR tiers from the API's `/leaguetiers` endpoint (ids 105000xxx); each
 * has three sub-divisions (a global "League N" number, and Legend III/II/I) which we collapse to the
 * major tier since that is the granularity leaders reason about for CWL ("Dragon and up", "Legend").
 *
 * IMPORTANT: this is the NEW `leagueTier` field on a player/member — NOT the legacy trophy `league`
 * field (Bronze…Titan…Legend, ids 29000xxx), which is a different scale that only shares the name
 * "Legend". Sync stores `member.leagueTier.name`; see normalizeLeague below.
 *
 * Pure/data-only so it is safe to import from both client components and the allocation engine.
 */
export const CWL_LEAGUES: { key: CWLLeague; label: string }[] = [
  { key: 'skeleton', label: 'Skeleton' },
  { key: 'barbarian', label: 'Barbarian' },
  { key: 'archer', label: 'Archer' },
  { key: 'wizard', label: 'Wizard' },
  { key: 'valkyrie', label: 'Valkyrie' },
  { key: 'witch', label: 'Witch' },
  { key: 'golem', label: 'Golem' },
  { key: 'pekka', label: 'P.E.K.K.A' },
  { key: 'titan', label: 'Titan' },
  { key: 'dragon', label: 'Dragon' },
  { key: 'electro', label: 'Electro' },
  { key: 'legend', label: 'Legend' },
];

const ORDER = new Map<CWLLeague, number>(CWL_LEAGUES.map((l, i) => [l.key, i]));

/** Rank of a league for comparison; an unknown/absent league sorts below every real league. */
export function leagueOrder(key: CWLLeague | null): number {
  return key ? (ORDER.get(key) ?? -1) : -1;
}

/** Human label for a league key ('—' when unknown). */
export function leagueLabel(key: CWLLeague | null): string {
  if (!key) return '—';
  return CWL_LEAGUES.find((l) => l.key === key)?.label ?? key;
}

// Distinctive keyword per major tier. The Ranked tier names are single words with no overlap
// (unlike the trophy scale), so plain substring matching is unambiguous. "Unranked" and legacy
// trophy-only names (Bronze/Silver/Gold/Crystal/Master/Champion) fall through to null — not this scale.
const MATCHERS: { needle: string; key: CWLLeague }[] = [
  { needle: 'skeleton', key: 'skeleton' },
  { needle: 'barbarian', key: 'barbarian' },
  { needle: 'archer', key: 'archer' },
  { needle: 'wizard', key: 'wizard' },
  { needle: 'valkyrie', key: 'valkyrie' },
  { needle: 'witch', key: 'witch' },
  { needle: 'golem', key: 'golem' },
  { needle: 'p.e.k.k.a', key: 'pekka' },
  { needle: 'pekka', key: 'pekka' },
  { needle: 'titan', key: 'titan' },
  { needle: 'dragon', key: 'dragon' },
  { needle: 'electro', key: 'electro' },
  { needle: 'legend', key: 'legend' },
];

/**
 * Map a raw Ranked-tier name from the CoC API (`member.leagueTier.name`, e.g. "Titan League 25",
 * "Electro League 31", "Legend III", "Unranked") to a major-league key, or null if it is not a
 * Ranked tier. Isolated here so a future API-naming change only touches this function.
 */
export function normalizeLeague(raw: string | null | undefined): CWLLeague | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  for (const m of MATCHERS) {
    if (s.includes(m.needle)) return m.key;
  }
  return null;
}
