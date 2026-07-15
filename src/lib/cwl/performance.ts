import type { CWLRound, CWLWarMember } from '@/types/database';

/**
 * CWL season performance roll-up (Phase 2).
 *
 * Aggregates the per-round war-member rows into per-member season totals for the performance panel.
 * Pure and side-effect free so the math is testable and the component stays thin — mirrors
 * src/lib/contribution.ts. Framed as recognition, not a ranking.
 *
 * A "missed attack" only counts once its round has ENDED (state === 'warEnded') with no attack used;
 * a member sitting in a preparation/inWar round hasn't missed yet.
 */

export interface MemberPerf {
  key: string;             // person_id when linked, else player_tag (grouping key)
  personId: string | null;
  playerTag: string | null;
  name: string;
  roundsPlayed: number;    // distinct rounds the member appeared in a lineup
  attacksUsed: number;
  totalStars: number;
  avgDestruction: number | null; // mean destruction over attacks used, null if none
  missed: number;          // rounds ended with an unused attack
}

export interface SeasonPerformance {
  perMember: MemberPerf[];
  totals: MemberPerf;      // family totals (name = 'All members')
}

const TOTALS_NAME = 'All members';

function emptyTotals(): MemberPerf {
  return {
    key: '__totals__', personId: null, playerTag: null, name: TOTALS_NAME,
    roundsPlayed: 0, attacksUsed: 0, totalStars: 0, avgDestruction: null, missed: 0,
  };
}

export function computeSeasonPerformance(rounds: CWLRound[], members: CWLWarMember[]): SeasonPerformance {
  const endedRoundIds = new Set(rounds.filter((r) => r.state === 'warEnded').map((r) => r.id));

  // Accumulate per member, keyed by person (linked) or tag (unlinked/guest).
  type Acc = MemberPerf & { destructionSum: number; roundIds: Set<string> };
  const byKey = new Map<string, Acc>();

  const ensure = (key: string, seed: Partial<Acc>): Acc => {
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        key, personId: null, playerTag: null, name: key,
        roundsPlayed: 0, attacksUsed: 0, totalStars: 0, avgDestruction: null, missed: 0,
        destructionSum: 0, roundIds: new Set(),
      };
      byKey.set(key, acc);
    }
    Object.assign(acc, { ...seed, ...{ personId: acc.personId ?? seed.personId ?? null } });
    return acc;
  };

  for (const m of members) {
    const key = m.person_id ?? m.player_tag;
    const acc = ensure(key, { personId: m.person_id, playerTag: m.player_tag, name: m.name || m.player_tag });
    acc.roundIds.add(m.round_id);
    acc.attacksUsed += m.attacks_used;
    acc.totalStars += m.stars;
    if (m.attacks_used > 0) acc.destructionSum += m.destruction;
    if (m.attacks_used === 0 && endedRoundIds.has(m.round_id)) acc.missed += 1;
  }

  const finalize = (acc: Acc): MemberPerf => ({
    key: acc.key,
    personId: acc.personId,
    playerTag: acc.playerTag,
    name: acc.name,
    roundsPlayed: acc.roundIds.size,
    attacksUsed: acc.attacksUsed,
    totalStars: acc.totalStars,
    avgDestruction: acc.attacksUsed > 0 ? acc.destructionSum / acc.attacksUsed : null,
    missed: acc.missed,
  });

  const perMember = Array.from(byKey.values())
    .map(finalize)
    .sort((a, b) => b.totalStars - a.totalStars);

  // Family totals: sum columns; avg destruction is the pooled mean over all attacks used.
  const totals = emptyTotals();
  let destructionSum = 0;
  for (const acc of byKey.values()) {
    totals.roundsPlayed += acc.roundIds.size;
    totals.attacksUsed += acc.attacksUsed;
    totals.totalStars += acc.totalStars;
    totals.missed += acc.missed;
    destructionSum += acc.destructionSum;
  }
  totals.avgDestruction = totals.attacksUsed > 0 ? destructionSum / totals.attacksUsed : null;

  return { perMember, totals };
}
