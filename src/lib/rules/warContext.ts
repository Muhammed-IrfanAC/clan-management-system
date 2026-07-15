import type { DetectedViolation } from './types';

/**
 * PURE war-attack reconstruction + the two judgement detectors (unjustified hit-up, low-rank late
 * snipe). No DB, no I/O — a WarContext is assembled from the DB by the detector wrappers
 * (detectors/hitUp.ts, detectors/lateSnipe.ts) and fed here, so this logic is fully unit-testable.
 *
 * The crux both rules share: reconstruct, from the war-global attack `order`, which enemy bases were
 * still OPEN (not yet 3-starred) at the moment of a given attack. An "equal or lower TH base left
 * open" is the evidence that an attacker either hit up (skipped an easier base for a harder one) or
 * sniped late instead of cleaning it up.
 */

export type LineupBase = { tag: string; th: number };

export type WarAttackRec = {
  order: number;
  attackerTag: string;
  attackerName: string | null;
  attackerPersonId: string | null; // null => unlinked/guest; never flagged (a warning needs a person)
  attackerTh: number;
  attackerRank: string | null;      // db_role at ingest, for the rank filter
  defenderTag: string;
  defenderTh: number;
  stars: number;
  firstSeenAt: string | null;       // ISO; when we first observed this attack across sync polls
  firstSeenState: string | null;    // war state at first sighting; 'inWar' => timing is trustworthy
};

export type WarContext = {
  source: 'regular' | 'cwl';
  roundId: string;
  clanId: string | null;
  opponentName: string | null;
  endTime: string | null;
  lineup: LineupBase[];
  attacks: WarAttackRec[];
};

/** Enemy base tags that were already 3-starred by an attack made BEFORE `order`. */
function clearedBefore(ctx: WarContext, order: number): Set<string> {
  const cleared = new Set<string>();
  for (const a of ctx.attacks) if (a.order < order && a.stars >= 3) cleared.add(a.defenderTag);
  return cleared;
}

/** Enemy bases with TH <= `maxTh` that were still open (not 3-starred) just before `order`. */
export function openBasesBefore(ctx: WarContext, order: number, maxTh: number): LineupBase[] {
  const cleared = clearedBefore(ctx, order);
  return ctx.lineup.filter((b) => b.th <= maxTh && !cleared.has(b.tag));
}

export type HitUpConfig = {
  // How much higher (in TH levels) the hit base must be than the attacker to count as "hitting up".
  min_th_gap?: number;
};

/**
 * Unjustified hit-up: an attacker hit a base at least `min_th_gap` TH levels ABOVE their own while an
 * equal-or-lower TH base sat open. Rank-agnostic — the rule is about target choice, not who made it.
 */
export function findHitUps(ctx: WarContext, config: HitUpConfig = {}): DetectedViolation[] {
  const minGap = Math.max(1, Number(config.min_th_gap ?? 1));
  const out: DetectedViolation[] = [];

  for (const a of ctx.attacks) {
    if (!a.attackerPersonId) continue;
    if (a.defenderTh - a.attackerTh < minGap) continue; // didn't hit up
    const open = openBasesBefore(ctx, a.order, a.attackerTh); // equal/lower bases still available
    if (!open.length) continue;

    const vs = ctx.opponentName ? ` vs ${ctx.opponentName}` : '';
    out.push({
      personId: a.attackerPersonId,
      playerTag: a.attackerTag,
      clanId: ctx.clanId,
      memberName: a.attackerName,
      description:
        `Possible unjustified hit-up — TH${a.attackerTh} hit a TH${a.defenderTh} base while ` +
        `${open.length} equal-or-lower base${open.length === 1 ? '' : 's'} (TH${lowestTh(open)}` +
        `${open.length === 1 ? '' : ' etc'}) sat open${vs}.`,
      dedupKey: `war_unjustified_hitup:${ctx.source}:${ctx.roundId}:${a.order}`,
      occurredAt: ctx.endTime || a.firstSeenAt || new Date(0).toISOString(),
      evidence: {
        attacker_th: a.attackerTh,
        defender_th: a.defenderTh,
        open_bases: open.map((b) => b.th),
        opponent: ctx.opponentName,
        source: ctx.source,
      },
    });
  }
  return out;
}

export type LateSnipeConfig = {
  window_hours?: number;   // "final N hours" window
  ranks?: string[];        // db_roles that count as low rank (default elder & below)
};

const DEFAULT_LOW_RANKS = ['member', 'elder'];

/**
 * Low-rank late snipe: a member of `ranks` (default elder-or-lower) attacked within the war's final
 * `window_hours` while an equal-or-lower TH base sat open — i.e. sniped instead of leaving/cleaning
 * up cleanup bases. Timing is only trusted when the attack was first observed while state was
 * 'inWar' (an attack first seen only at 'warEnded' has no reliable timestamp and is skipped).
 * An attacker who used their late hit to 3-star the last open equal/lower base is NOT flagged.
 */
export function findLateSnipes(ctx: WarContext, config: LateSnipeConfig = {}): DetectedViolation[] {
  const windowMs = Math.max(0, Number(config.window_hours ?? 6)) * 3600 * 1000;
  const ranks = new Set((config.ranks && config.ranks.length ? config.ranks : DEFAULT_LOW_RANKS));
  if (!ctx.endTime) return [];
  const endMs = new Date(ctx.endTime).getTime();
  const out: DetectedViolation[] = [];

  for (const a of ctx.attacks) {
    if (!a.attackerPersonId) continue;
    if (!a.attackerRank || !ranks.has(a.attackerRank)) continue; // not a low rank
    if (a.firstSeenState !== 'inWar' || !a.firstSeenAt) continue; // timing not trustworthy
    const remainingMs = endMs - new Date(a.firstSeenAt).getTime();
    if (remainingMs > windowMs) continue; // not in the final window

    // Equal/lower bases open just before this attack, minus one this attack itself 3-starred
    // (that would be legitimate cleanup, not a snipe).
    const open = openBasesBefore(ctx, a.order, a.attackerTh).filter(
      (b) => !(b.tag === a.defenderTag && a.stars >= 3),
    );
    if (!open.length) continue;

    const hoursLeft = Math.max(0, remainingMs) / 3600000;
    const vs = ctx.opponentName ? ` vs ${ctx.opponentName}` : '';
    out.push({
      personId: a.attackerPersonId,
      playerTag: a.attackerTag,
      clanId: ctx.clanId,
      memberName: a.attackerName,
      description:
        `Possible late snipe — ${a.attackerName || a.attackerTag} (${a.attackerRank}) attacked with ` +
        `~${fmtHours(hoursLeft)} left while an equal-or-lower base (TH${lowestTh(open)}) sat open${vs}.`,
      dedupKey: `war_late_snipe:${ctx.source}:${ctx.roundId}:${a.order}`,
      occurredAt: ctx.endTime,
      evidence: {
        attacker_th: a.attackerTh,
        rank: a.attackerRank,
        hours_left: Number(hoursLeft.toFixed(1)),
        open_bases: open.map((b) => b.th),
        opponent: ctx.opponentName,
        source: ctx.source,
      },
    });
  }
  return out;
}

function lowestTh(bases: LineupBase[]): number {
  return bases.reduce((min, b) => Math.min(min, b.th), Infinity);
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}
