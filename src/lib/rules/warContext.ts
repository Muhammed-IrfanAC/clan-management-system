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
  attackerRank: string | null;      // db_role at ingest — for display/evidence only, NOT the exemption
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
  // Persons exempt from the rule: those the org designated leadership via persons.access_role.
  // Supplied by the detector wrapper (a DB read). access_role is per-person, so the exemption spans
  // every one of a leader's linked alts, whatever that alt's in-game rank was when it attacked.
  exemptPersonIds?: Set<string>;
};

/**
 * Unjustified hit-up: a member hit a base at least `min_th_gap` TH levels ABOVE their own while an
 * equal-or-lower TH base sat open. Leadership (leaders/co-leaders, by persons.access_role) is exempt —
 * they often hit up deliberately to open the map — and, because access_role lives on the person, so
 * are all of a leader's alts.
 *
 * At most one violation per member per war: a member who hits up on BOTH of their attacks is flagged
 * once (the earliest by attack order), so the dedup_key — and therefore the leader's queue — carries a
 * single entry per person, not one per attack.
 */
export function findHitUps(ctx: WarContext, config: HitUpConfig = {}): DetectedViolation[] {
  const minGap = Math.max(1, Number(config.min_th_gap ?? 1));
  const exempt = config.exemptPersonIds ?? new Set<string>();
  const out: DetectedViolation[] = [];
  const seen = new Set<string>(); // personIds already flagged this war

  // Earliest-order-first so the representative attack (and its evidence) is deterministic.
  for (const a of [...ctx.attacks].sort((x, y) => x.order - y.order)) {
    if (!a.attackerPersonId) continue;
    if (exempt.has(a.attackerPersonId)) continue; // leader/co-leader (by access_role) — exempt
    if (a.defenderTh - a.attackerTh < minGap) continue; // didn't hit up
    const open = openBasesBefore(ctx, a.order, a.attackerTh); // equal/lower bases still available
    if (!open.length) continue;
    if (seen.has(a.attackerPersonId)) continue; // already flagged for an earlier attack this war
    seen.add(a.attackerPersonId);

    const vs = ctx.opponentName ? ` vs ${ctx.opponentName}` : '';
    out.push({
      personId: a.attackerPersonId,
      playerTag: a.attackerTag,
      clanId: ctx.clanId,
      source: ctx.source,
      memberName: a.attackerName,
      description:
        `Possible unjustified hit-up — TH${a.attackerTh} hit a TH${a.defenderTh} base while ` +
        `${open.length} equal-or-lower base${open.length === 1 ? '' : 's'} (TH${lowestTh(open)}` +
        `${open.length === 1 ? '' : ' etc'}) sat open${vs}.`,
      // Per-person (not per-attack) so both hits by the same member collapse into one violation.
      dedupKey: `war_unjustified_hitup:${ctx.source}:${ctx.roundId}:${a.attackerPersonId}`,
      occurredAt: ctx.endTime || a.firstSeenAt || new Date(0).toISOString(),
      warRoundId: ctx.roundId,
      warLabel: warLabelFor(ctx),
      evidence: {
        attacker_th: a.attackerTh,
        defender_th: a.defenderTh,
        rank: a.attackerRank,
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
  // Leadership (persons.access_role) is exempt — per-person, so it covers a leader's alts too.
  exemptPersonIds?: Set<string>;
};

/**
 * Late snipe: a member attacked within the war's final `window_hours`. Any such late attack is
 * flagged — this catches members who deliberately wait until the end to snipe loot off already-cleared
 * higher bases, not just those who left an equal-or-lower base open. Leadership (leaders/co-leaders, by
 * persons.access_role, and all their alts) is exempt. Timing is only trusted when the attack was first
 * observed while state was 'inWar' (an attack first seen only at 'warEnded' has no reliable timestamp
 * and is skipped).
 *
 * At most one violation per member per war: a member who snipes on BOTH of their attacks is flagged
 * once, with both late hits CONCATENATED into a single description/evidence entry. Keying the dedup_key
 * per person (not per attack) means the strike carries one line, not two near-identical ones — the same
 * collapse findHitUps does.
 */
export function findLateSnipes(ctx: WarContext, config: LateSnipeConfig = {}): DetectedViolation[] {
  const windowMs = Math.max(0, Number(config.window_hours ?? 6)) * 3600 * 1000;
  const exempt = config.exemptPersonIds ?? new Set<string>();
  if (!ctx.endTime) return [];
  const endMs = new Date(ctx.endTime).getTime();

  // Gather every qualifying late attack, grouped by person, preserving attack order.
  type LateHit = { defenderTh: number; hoursLeft: number };
  type Group = {
    personId: string;
    playerTag: string;
    attackerName: string | null;
    attackerRank: string | null;
    attackerTh: number;
    hits: LateHit[];
  };
  const groups = new Map<string, Group>();

  for (const a of [...ctx.attacks].sort((x, y) => x.order - y.order)) {
    if (!a.attackerPersonId) continue;
    if (exempt.has(a.attackerPersonId)) continue; // leader/co-leader (by access_role) — exempt
    if (a.firstSeenState !== 'inWar' || !a.firstSeenAt) continue; // timing not trustworthy
    const remainingMs = endMs - new Date(a.firstSeenAt).getTime();
    if (remainingMs > windowMs) continue; // not in the final window

    const g =
      groups.get(a.attackerPersonId) ??
      {
        personId: a.attackerPersonId,
        playerTag: a.attackerTag,
        attackerName: a.attackerName,
        attackerRank: a.attackerRank,
        attackerTh: a.attackerTh,
        hits: [],
      };
    g.hits.push({ defenderTh: a.defenderTh, hoursLeft: Math.max(0, remainingMs) / 3600000 });
    groups.set(a.attackerPersonId, g);
  }

  const vs = ctx.opponentName ? ` vs ${ctx.opponentName}` : '';
  const out: DetectedViolation[] = [];
  for (const g of groups.values()) {
    out.push({
      personId: g.personId,
      playerTag: g.playerTag,
      clanId: ctx.clanId,
      source: ctx.source,
      memberName: g.attackerName,
      description: `Possible late snipe — ${g.attackerName || g.playerTag} (${g.attackerRank}) ${lateHitsPhrase(g.hits)}${vs}.`,
      // Per-person (not per-attack) so both late hits by the same member collapse into one violation.
      dedupKey: `war_late_snipe:${ctx.source}:${ctx.roundId}:${g.personId}`,
      occurredAt: ctx.endTime,
      warRoundId: ctx.roundId,
      warLabel: warLabelFor(ctx),
      evidence: {
        attacker_th: g.attackerTh,
        rank: g.attackerRank,
        opponent: ctx.opponentName,
        source: ctx.source,
        // The representative first hit stays top-level for back-compat; all late hits are itemised.
        defender_th: g.hits[0].defenderTh,
        hours_left: Number(g.hits[0].hoursLeft.toFixed(1)),
        late_attacks: g.hits.map((h) => ({
          defender_th: h.defenderTh,
          hours_left: Number(h.hoursLeft.toFixed(1)),
        })),
      },
    });
  }
  return out;
}

/** Phrasing for one or more late hits, e.g. "attacked a TH14 base with ~3.0h left" or
 * "made 2 late attacks (TH14 ~3.0h left, TH15 ~1.0h left)". */
function lateHitsPhrase(hits: { defenderTh: number; hoursLeft: number }[]): string {
  if (hits.length === 1) {
    return `attacked a TH${hits[0].defenderTh} base with ~${fmtHours(hits[0].hoursLeft)} left`;
  }
  const parts = hits.map((h) => `TH${h.defenderTh} ~${fmtHours(h.hoursLeft)} left`).join(', ');
  return `made ${hits.length} late attacks (${parts})`;
}

/** Human war label for a strike, e.g. 'CWL war vs X' / 'Clan war vs Y'. */
function warLabelFor(ctx: WarContext): string {
  const kind = ctx.source === 'cwl' ? 'CWL war' : 'Clan war';
  return `${kind}${ctx.opponentName ? ` vs ${ctx.opponentName}` : ''}`;
}

function lowestTh(bases: LineupBase[]): number {
  return bases.reduce((min, b) => Math.min(min, b.th), Infinity);
}

function fmtHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(1)}h`;
}
