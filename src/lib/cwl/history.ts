import type { CWLSeason, CWLRound, CWLWarMember } from '@/types/database';

/**
 * CWL cross-season history roll-up (Phase 3).
 *
 * Aggregates every season's stored rounds/war-members into a per-person CAREER record and a
 * per-season family trend. Pure and side-effect free so the math is testable and the components
 * stay thin — mirrors src/lib/cwl/performance.ts (which does the same for a single season).
 *
 * Grouping and the "missed attack" rule match performance.ts: a member is keyed by person_id when
 * linked else player_tag, and a miss only counts once its round has ENDED (state === 'warEnded')
 * with no attack used. seasonsMissedIn counts DISTINCT seasons a person missed in — two misses in
 * one season is still one season — which is the signal that separates a repeat offender from an
 * unlucky one-off.
 */

export interface CareerStat {
  key: string;                    // person_id when linked, else player_tag
  personId: string | null;
  playerTag: string | null;
  name: string;
  seasonsPlayed: number;          // distinct seasons the person appeared in a lineup
  roundsPlayed: number;           // distinct rounds across all seasons
  attacksUsed: number;
  totalStars: number;
  avgDestruction: number | null;  // pooled mean over attacks used, null if none
  missed: number;                 // ended rounds with an unused attack (all seasons)
  missedRate: number | null;      // missed / (attacksUsed + missed), null if no expected attacks
  seasonsMissedIn: number;        // distinct seasons with >= 1 missed attack
  attendanceRate: number;         // seasonsPlayed / totalSeasonsWithData (0..1)
}

export interface SeasonTrendPoint {
  seasonId: string;
  label: string;
  starsPerAttack: number | null;  // family total stars / attacks used that season
  participants: number;           // distinct members fielded that season
}

export interface CareerHistory {
  perPerson: CareerStat[];
  trend: SeasonTrendPoint[];
  repeatMissers: CareerStat[];
  totalSeasonsWithData: number;
}

export function computeCareerStats(
  seasons: CWLSeason[],
  rounds: CWLRound[],
  members: CWLWarMember[],
): CareerHistory {
  // Round lookups: which season a round belongs to, and whether it has ended (a miss can count).
  const roundSeason = new Map<string, string>();
  const roundEnded = new Map<string, boolean>();
  for (const r of rounds) {
    roundSeason.set(r.id, r.season_id);
    roundEnded.set(r.id, r.state === 'warEnded');
  }

  // Seasons that actually produced round data — the attendance denominator and trend x-axis.
  const seasonsWithData = new Set<string>();
  for (const r of rounds) seasonsWithData.add(r.season_id);

  type Acc = {
    key: string;
    personId: string | null;
    playerTag: string | null;
    name: string;
    seasons: Set<string>;
    rounds: Set<string>;
    attacksUsed: number;
    totalStars: number;
    destructionSum: number;
    missed: number;
    missedSeasons: Set<string>;
  };
  const byKey = new Map<string, Acc>();

  // Per-season family tallies for the trend line.
  const seasonStars = new Map<string, number>();
  const seasonAttacks = new Map<string, number>();
  const seasonParticipants = new Map<string, Set<string>>();

  for (const m of members) {
    const seasonId = roundSeason.get(m.round_id);
    if (!seasonId) continue; // orphan member (round not in the fetched set) — skip defensively
    const key = m.person_id ?? m.player_tag;

    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        key, personId: null, playerTag: null, name: key,
        seasons: new Set(), rounds: new Set(),
        attacksUsed: 0, totalStars: 0, destructionSum: 0,
        missed: 0, missedSeasons: new Set(),
      };
      byKey.set(key, acc);
    }
    // First non-null wins for the identity fields; name prefers a real label over the tag.
    acc.personId = acc.personId ?? m.person_id;
    acc.playerTag = acc.playerTag ?? m.player_tag;
    if (m.name) acc.name = m.name;
    else if (acc.name === key) acc.name = m.player_tag;

    acc.seasons.add(seasonId);
    acc.rounds.add(m.round_id);
    acc.attacksUsed += m.attacks_used;
    acc.totalStars += m.stars;
    if (m.attacks_used > 0) acc.destructionSum += m.destruction;
    if (m.attacks_used === 0 && roundEnded.get(m.round_id)) {
      acc.missed += 1;
      acc.missedSeasons.add(seasonId);
    }

    // Family trend tallies.
    seasonStars.set(seasonId, (seasonStars.get(seasonId) ?? 0) + m.stars);
    seasonAttacks.set(seasonId, (seasonAttacks.get(seasonId) ?? 0) + m.attacks_used);
    if (!seasonParticipants.has(seasonId)) seasonParticipants.set(seasonId, new Set());
    seasonParticipants.get(seasonId)!.add(key);
  }

  const totalSeasonsWithData = seasonsWithData.size;

  const perPerson: CareerStat[] = Array.from(byKey.values())
    .map((acc): CareerStat => {
      const expected = acc.attacksUsed + acc.missed;
      return {
        key: acc.key,
        personId: acc.personId,
        playerTag: acc.playerTag,
        name: acc.name,
        seasonsPlayed: acc.seasons.size,
        roundsPlayed: acc.rounds.size,
        attacksUsed: acc.attacksUsed,
        totalStars: acc.totalStars,
        avgDestruction: acc.attacksUsed > 0 ? acc.destructionSum / acc.attacksUsed : null,
        missed: acc.missed,
        missedRate: expected > 0 ? acc.missed / expected : null,
        seasonsMissedIn: acc.missedSeasons.size,
        attendanceRate: totalSeasonsWithData > 0 ? acc.seasons.size / totalSeasonsWithData : 0,
      };
    })
    .sort((a, b) => b.totalStars - a.totalStars);

  const repeatMissers = perPerson
    .filter((p) => p.seasonsMissedIn >= 2)
    .sort((a, b) => b.seasonsMissedIn - a.seasonsMissedIn || b.missed - a.missed);

  // Trend: one point per season that produced round data, oldest → newest for the x-axis.
  const trend: SeasonTrendPoint[] = seasons
    .filter((s) => seasonsWithData.has(s.id))
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((s) => {
      const attacks = seasonAttacks.get(s.id) ?? 0;
      return {
        seasonId: s.id,
        label: s.label,
        starsPerAttack: attacks > 0 ? (seasonStars.get(s.id) ?? 0) / attacks : null,
        participants: seasonParticipants.get(s.id)?.size ?? 0,
      };
    });

  return { perPerson, trend, repeatMissers, totalSeasonsWithData };
}
