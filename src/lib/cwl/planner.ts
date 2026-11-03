/**
 * CWL week planner — who plays which war, for one clan.
 *
 * The goal is leadership's, in strict order:
 *   1. get as many accounts as possible to STAR_TARGET (8★) by the end of the season — clean
 *      accounts first, accounts flagged `rule_breaker` second;
 *   2. then maximise the clan's expected stars, so the clan finishes high in its league.
 * Rounds played are deliberately not a goal; nobody is guaranteed a slot.
 *
 * The model:
 *  - Each war is played MIRROR: our base at map position k hits theirs at position k. Our map order
 *    is predicted as TH, then where the game placed each account in past lineups (warOrder.ts —
 *    the API has no war weight), then Ranked tier. Because positions shift whenever the lineup changes,
 *    a round is always evaluated as a whole lineup, never one player at a time.
 *  - Per-attack expectation comes from starModel.ts (strength band × TH levels hit up).
 *  - The next war's opponent is known once its prep day starts; for later rounds we only know WHICH
 *    clans are left, not the order, so an unrevealed round is scored as the average over every
 *    remaining opponent. Only revealed rounds can therefore be told apart as easy or tough — the
 *    plan for the rest is provisional by nature.
 *
 * The search is a deterministic greedy construction (chasers first, into the rounds where they
 * expect the most stars) followed by local improvement: swap one player in a round, or exchange two
 * players across two rounds, accepting a change only when it improves the goal tuple above.
 *
 * Leader controls, all per account:
 *  - `banned` / opted out / unranked: never planned (unless forced into a specific war).
 *  - `ruleBreaker`: still planned, but their 8★ counts below every clean account's.
 *  - per-war `forceIn` / `forceOut`: applies to that one war only and wins over everything else.
 *
 * Pure: no I/O, unit-tested beside it.
 */
import { expectedStars } from './starModel';
import { isGoat, isUnranked, rateStrength, type AttackerStrength } from './strength';
import { tierOrder } from './leagues';

/** The family's goal per account per season. */
export const STAR_TARGET = 8;

/** Tolerance for comparing expected-star sums. */
const EPS = 1e-9;

/** Upper bound on improvement passes — the search normally settles in a handful. */
const MAX_PASSES = 200;

export interface PlannerAccount {
  playerTag: string;
  name: string;
  thLevel: number;
  leagueTier: number | null;
  /**
   * Not in our database, so its league is UNKNOWN — not the same as unranked. Rated medium (the
   * house rating for anything the bands do not cover) and planned like anyone else.
   */
  untracked?: boolean;
  /** Stars from attacks already made this season. */
  starsSoFar: number;
  /**
   * Expected stars already locked in but not yet scored: the account is in the lineup of a war at
   * battle day and has not attacked yet. The I/O layer computes it with starModel.
   */
  pendingExpected?: number;
  banned?: boolean;
  ruleBreaker?: boolean;
  /** Opted out of the whole season. */
  optedOut?: boolean;
  /** Rounds the account cannot fight (a season-level partial opt-out). */
  unavailableRounds?: ReadonlySet<number>;
  /**
   * Where the game has placed this account in past lineups (warOrder.ts): −1…+1, higher = nearer
   * the top. Null/absent when it has never shared a lineup — it then sorts after the scored
   * accounts of its town hall.
   */
  warOrder?: number | null;
}

export interface PlannerRound {
  roundNumber: number;
  /** The opponent's lineup TH by map position (index 0 = #1), once revealed; null = not yet known. */
  enemyLineup: number[] | null;
  /** Leader overrides for THIS war only. */
  forceIn?: ReadonlySet<string>;
  forceOut?: ReadonlySet<string>;
  /**
   * Accounts whose in-game war preference is "out". Set on the NEXT war only — the toggle is a
   * short-term request — and, like any availability, overridden by a leader's force-in.
   */
  preferenceOut?: ReadonlySet<string>;
}

export interface PlannerInput {
  warSize: number;
  accounts: PlannerAccount[];
  /** The rounds still open to planning (not yet at battle day). */
  rounds: PlannerRound[];
  /**
   * Signed rosters (TH per member) of opponents not yet faced and not already drawn in a revealed
   * round. Unrevealed rounds are scored against the average of these. Empty = nothing known yet,
   * and every unrevealed position is assumed to mirror the attacker's own TH.
   */
  futureOpponents: number[][];
  starTarget?: number;
}

export type ExclusionReason = 'banned' | 'opted_out' | 'unranked';
export type SlotReason = 'forced_in' | 'chasing' | 'strength';
export type BenchReason = 'target_reached' | 'covered_elsewhere' | 'not_reachable';
export type UnavailableReason = 'forced_out' | 'war_preference' | 'unavailable' | ExclusionReason;

export interface PlannedSlot {
  playerTag: string;
  name: string;
  thLevel: number;
  strength: AttackerStrength;
  /** Display-only highlight for the strongest players (strength.ts `isGoat`); still `strong` here. */
  goat: boolean;
  mapPosition: number; // 1-based
  /** The mirror base's TH when the opponent is revealed; null while it is an average over opponents. */
  enemyTh: number | null;
  expectedStars: number;
  reason: SlotReason;
}

export interface SideSlot<R> {
  playerTag: string;
  name: string;
  thLevel: number;
  reason: R;
}

export interface RoundPlan {
  roundNumber: number;
  enemyKnown: boolean;
  lineup: PlannedSlot[]; // in predicted map order
  bench: SideSlot<BenchReason>[];
  unavailable: SideSlot<UnavailableReason>[];
  expectedClanStars: number;
  /** Positions left empty because too few accounts were available. */
  shortBy: number;
  /** More accounts were forced in than the war has slots; the weakest of them were dropped. */
  overForced: boolean;
}

export type OutlookStatus = 'excluded' | 'reached' | 'on_track' | 'short' | 'not_planned';

export interface AccountOutlook {
  playerTag: string;
  name: string;
  thLevel: number;
  leagueTier: number | null;
  strength: AttackerStrength | null; // null when unranked
  goat: boolean; // display-only, see PlannedSlot.goat
  untracked: boolean;
  ruleBreaker: boolean;
  starsSoFar: number;
  /** starsSoFar + pendingExpected. */
  committed: number;
  /** committed + expected stars from every planned round. */
  projected: number;
  plannedRounds: number[];
  status: OutlookStatus;
  excludedReason: ExclusionReason | null;
}

export interface SeasonPlan {
  starTarget: number;
  warSize: number;
  rounds: RoundPlan[];
  accounts: AccountOutlook[]; // strongest first
  totals: {
    reachedClean: number;
    reachedRuleBreakers: number;
    /** Accounts still short of the target and eligible to play. */
    chasers: number;
    expectedClanStars: number;
  };
}

// ---------------------------------------------------------------------------------------------

interface Acc extends PlannerAccount {
  strength: AttackerStrength;
  committed: number;
  exclusion: ExclusionReason | null;
}

/** Predicted map order: TH, then observed war order, then Ranked tier, then name/tag for stability. */
function byMapOrder(a: Acc, b: Acc): number {
  if (b.thLevel !== a.thLevel) return b.thLevel - a.thLevel;
  // Within a town hall, the game's own past placements (warOrder.ts) — the only thing that predicts
  // its war-weight order. Accounts it has never placed come after those it has.
  const wa = a.warOrder ?? null;
  const wb = b.warOrder ?? null;
  if ((wa === null) !== (wb === null)) return wa === null ? 1 : -1;
  if (wa !== null && wb !== null && wa !== wb) return wb - wa;
  const t = tierOrder(b.leagueTier) - tierOrder(a.leagueTier);
  if (t !== 0) return t;
  const n = a.name.localeCompare(b.name);
  return n !== 0 ? n : a.playerTag.localeCompare(b.playerTag);
}

function exclusionOf(a: PlannerAccount): ExclusionReason | null {
  if (a.banned) return 'banned';
  if (a.optedOut) return 'opted_out';
  if (!a.untracked && isUnranked(a.leagueTier)) return 'unranked';
  return null;
}

/** The opponent at each map position: one TH when revealed, every remaining opponent's otherwise. */
function enemyPositions(round: PlannerRound, warSize: number, futureOpponents: number[][]): (number[] | null)[] {
  const out: (number[] | null)[] = [];
  if (round.enemyLineup) {
    for (let k = 0; k < warSize; k++) {
      const th = round.enemyLineup[k];
      out.push(th == null ? null : [th]);
    }
    return out;
  }
  // An opponent's likely lineup is its strongest `warSize` members, in TH order.
  const lineups = futureOpponents.map((roster) => roster.slice().sort((x, y) => y - x).slice(0, warSize));
  for (let k = 0; k < warSize; k++) {
    const ths = lineups.map((l) => l[k]).filter((th): th is number => th != null);
    out.push(ths.length ? ths : null);
  }
  return out;
}

interface RoundCtx {
  round: PlannerRound;
  enemy: (number[] | null)[];
  forced: Acc[]; // forced in, already capped to warSize
  overForced: boolean;
  pool: Acc[]; // eligible, not forced, available — the accounts the planner may choose from
  unavailable: SideSlot<UnavailableReason>[];
}

interface RoundEval {
  order: Acc[]; // lineup in map order
  stars: Map<string, number>;
  total: number;
}

type Score = [number, number, number];

function better(a: Score, b: Score): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2] + EPS;
}

export function planSeason(input: PlannerInput): SeasonPlan {
  const { warSize } = input;
  const target = input.starTarget ?? STAR_TARGET;

  const accs: Acc[] = input.accounts.map((a) => ({
    ...a,
    strength: a.untracked ? 'medium' : rateStrength(a.thLevel, a.leagueTier),
    committed: a.starsSoFar + (a.pendingExpected ?? 0),
    exclusion: exclusionOf(a),
  }));
  const rounds = input.rounds.slice().sort((a, b) => a.roundNumber - b.roundNumber);

  // ---- per-round context -------------------------------------------------------------------
  const ctxs: RoundCtx[] = rounds.map((round) => {
    const forcedAll = accs.filter((a) => round.forceIn?.has(a.playerTag)).sort(byMapOrder);
    const unavailable: SideSlot<UnavailableReason>[] = [];
    const pool: Acc[] = [];
    for (const a of accs) {
      if (round.forceIn?.has(a.playerTag)) continue;
      let reason: UnavailableReason | null = null;
      if (round.forceOut?.has(a.playerTag)) reason = 'forced_out';
      else if (round.preferenceOut?.has(a.playerTag)) reason = 'war_preference';
      else if (a.exclusion) reason = a.exclusion;
      else if (a.unavailableRounds?.has(round.roundNumber)) reason = 'unavailable';
      if (reason) unavailable.push({ playerTag: a.playerTag, name: a.name, thLevel: a.thLevel, reason });
      else pool.push(a);
    }
    return {
      round,
      enemy: enemyPositions(round, warSize, input.futureOpponents),
      forced: forcedAll.slice(0, warSize),
      overForced: forcedAll.length > warSize,
      pool: pool.sort(byMapOrder),
      unavailable,
    };
  });

  const evalRound = (ctx: RoundCtx, chosen: Set<string>): RoundEval => {
    const order = [...ctx.forced, ...ctx.pool.filter((a) => chosen.has(a.playerTag))].sort(byMapOrder);
    const stars = new Map<string, number>();
    let total = 0;
    order.forEach((a, k) => {
      const ths = ctx.enemy[k];
      const e = ths
        ? ths.reduce((s, th) => s + expectedStars(a.strength, a.thLevel, th), 0) / ths.length
        : expectedStars(a.strength, a.thLevel, a.thLevel);
      stars.set(a.playerTag, e);
      total += e;
    });
    return { order, stars, total };
  };

  // ---- greedy construction -----------------------------------------------------------------
  const chosen: Set<string>[] = ctxs.map(() => new Set());
  const capacity = ctxs.map((c) => warSize - c.forced.length);

  // A rough per-round estimate for seeding: the account at its strength rank within the round's pool.
  const roughStars = (a: Acc, ri: number): number => {
    const ctx = ctxs[ri];
    const all = [...ctx.forced, ...ctx.pool].sort(byMapOrder);
    const k = Math.min(all.indexOf(a), warSize - 1);
    const ths = ctx.enemy[k];
    return ths
      ? ths.reduce((s, th) => s + expectedStars(a.strength, a.thLevel, th), 0) / ths.length
      : expectedStars(a.strength, a.thLevel, a.thLevel);
  };

  const forcedStars = (a: Acc): number =>
    ctxs.reduce((s, c) => s + (c.forced.includes(a) ? roughStars(a, ctxs.indexOf(c)) : 0), 0);

  const chasers = accs
    .filter((a) => !a.exclusion && a.committed < target - EPS)
    .map((a) => {
      const avail = ctxs.map((c, ri) => (c.pool.includes(a) ? ri : -1)).filter((ri) => ri >= 0);
      const avg = avail.length ? avail.reduce((s, ri) => s + roughStars(a, ri), 0) / avail.length : 0;
      const need = target - a.committed - forcedStars(a);
      return { a, avail, need, roundsNeeded: avg > 0 ? need / avg : Infinity };
    })
    // Clean before rule breakers; then the cheapest to get over the line, which maximises the count.
    .sort(
      (x, y) =>
        Number(!!x.a.ruleBreaker) - Number(!!y.a.ruleBreaker) ||
        x.roundsNeeded - y.roundsNeeded ||
        byMapOrder(x.a, y.a),
    );

  for (const c of chasers) {
    if (c.need <= EPS) continue;
    const options = c.avail
      .filter((ri) => capacity[ri] > 0)
      .map((ri) => ({ ri, e: roughStars(c.a, ri) }))
      .sort((x, y) => y.e - x.e || x.ri - y.ri);
    const picked: number[] = [];
    let got = 0;
    for (const o of options) {
      if (got >= c.need - EPS) break;
      picked.push(o.ri);
      got += o.e;
    }
    if (got < c.need - EPS) continue; // cannot get there — do not spend slots on them
    for (const ri of picked) {
      chosen[ri].add(c.a.playerTag);
      capacity[ri]--;
    }
  }
  // Fill what is left with the strongest available.
  ctxs.forEach((ctx, ri) => {
    for (const a of ctx.pool) {
      if (capacity[ri] <= 0) break;
      if (chosen[ri].has(a.playerTag)) continue;
      chosen[ri].add(a.playerTag);
      capacity[ri]--;
    }
  });

  // ---- scoring -------------------------------------------------------------------------------
  let evals = ctxs.map((ctx, ri) => evalRound(ctx, chosen[ri]));

  const projectedOf = (es: RoundEval[]): Map<string, number> => {
    const p = new Map(accs.map((a) => [a.playerTag, a.committed] as const));
    for (const e of es) for (const [tag, s] of e.stars) p.set(tag, p.get(tag)! + s);
    return p;
  };
  const scoreOf = (es: RoundEval[]): Score => {
    const p = projectedOf(es);
    let clean = 0;
    let rb = 0;
    for (const a of accs) {
      if (p.get(a.playerTag)! < target - EPS) continue;
      if (a.ruleBreaker) rb++;
      else clean++;
    }
    return [clean, rb, es.reduce((s, e) => s + e.total, 0)];
  };

  // ---- local improvement ---------------------------------------------------------------------
  let score = scoreOf(evals);
  const tryApply = (changes: [number, Set<string>][]): boolean => {
    const next = evals.slice();
    for (const [ri, set] of changes) next[ri] = evalRound(ctxs[ri], set);
    const s = scoreOf(next);
    if (!better(s, score)) return false;
    for (const [ri, set] of changes) chosen[ri] = set;
    evals = next;
    score = s;
    return true;
  };

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;

    // 1. Swap one player for another within a round.
    for (let ri = 0; ri < ctxs.length; ri++) {
      const pool = ctxs[ri].pool;
      for (const out of pool) {
        if (!chosen[ri].has(out.playerTag)) continue;
        for (const inn of pool) {
          if (chosen[ri].has(inn.playerTag)) continue;
          const set = new Set(chosen[ri]);
          set.delete(out.playerTag);
          set.add(inn.playerTag);
          if (tryApply([[ri, set]])) {
            improved = true;
            break;
          }
        }
      }
    }

    // 2. Exchange two players across two rounds (each keeps their number of wars).
    for (let r1 = 0; r1 < ctxs.length; r1++) {
      for (let r2 = r1 + 1; r2 < ctxs.length; r2++) {
        const inPool2 = new Set(ctxs[r2].pool.map((a) => a.playerTag));
        const inPool1 = new Set(ctxs[r1].pool.map((a) => a.playerTag));
        const as = [...chosen[r1]].filter((t) => inPool2.has(t) && !chosen[r2].has(t)).sort();
        for (const a of as) {
          if (!chosen[r1].has(a) || chosen[r2].has(a)) continue; // moved by an earlier exchange
          const bs = [...chosen[r2]].filter((t) => inPool1.has(t) && !chosen[r1].has(t)).sort();
          for (const b of bs) {
            const s1 = new Set(chosen[r1]);
            s1.delete(a);
            s1.add(b);
            const s2 = new Set(chosen[r2]);
            s2.delete(b);
            s2.add(a);
            if (tryApply([[r1, s1], [r2, s2]])) {
              improved = true;
              break;
            }
          }
        }
      }
    }

    if (!improved) break;
  }

  // ---- output --------------------------------------------------------------------------------
  const projected = projectedOf(evals);
  const reached = (tag: string) => projected.get(tag)! >= target - EPS;

  const roundPlans: RoundPlan[] = ctxs.map((ctx, ri) => {
    const ev = evals[ri];
    const known = ctx.round.enemyLineup != null;
    const lineup: PlannedSlot[] = ev.order.map((a, k) => ({
      playerTag: a.playerTag,
      name: a.name,
      thLevel: a.thLevel,
      strength: a.strength,
      goat: !a.untracked && isGoat(a.thLevel, a.leagueTier),
      mapPosition: k + 1,
      enemyTh: known ? (ctx.enemy[k]?.[0] ?? null) : null,
      expectedStars: ev.stars.get(a.playerTag)!,
      reason: ctx.forced.includes(a) ? 'forced_in' : a.committed < target - EPS ? 'chasing' : 'strength',
    }));
    const bench: SideSlot<BenchReason>[] = ctx.pool
      .filter((a) => !chosen[ri].has(a.playerTag))
      .map((a) => ({
        playerTag: a.playerTag,
        name: a.name,
        thLevel: a.thLevel,
        reason:
          a.committed >= target - EPS ? 'target_reached' : reached(a.playerTag) ? 'covered_elsewhere' : 'not_reachable',
      }));
    return {
      roundNumber: ctx.round.roundNumber,
      enemyKnown: known,
      lineup,
      bench,
      unavailable: ctx.unavailable,
      expectedClanStars: ev.total,
      shortBy: Math.max(0, warSize - lineup.length),
      overForced: ctx.overForced,
    };
  });

  const accounts: AccountOutlook[] = accs
    .slice()
    .sort(byMapOrder)
    .map((a) => {
      const plannedRounds = roundPlans
        .filter((r) => r.lineup.some((s) => s.playerTag === a.playerTag))
        .map((r) => r.roundNumber);
      const p = projected.get(a.playerTag)!;
      let status: OutlookStatus;
      if (a.committed >= target - EPS) status = 'reached';
      else if (a.exclusion && plannedRounds.length === 0) status = 'excluded';
      else if (p >= target - EPS) status = 'on_track';
      else status = plannedRounds.length ? 'short' : 'not_planned';
      return {
        playerTag: a.playerTag,
        name: a.name,
        thLevel: a.thLevel,
        leagueTier: a.leagueTier,
        strength: a.exclusion === 'unranked' ? null : a.strength,
        goat: !a.untracked && isGoat(a.thLevel, a.leagueTier),
        untracked: !!a.untracked,
        ruleBreaker: !!a.ruleBreaker,
        starsSoFar: a.starsSoFar,
        committed: a.committed,
        projected: p,
        plannedRounds,
        status,
        excludedReason: a.exclusion,
      };
    });

  return {
    starTarget: target,
    warSize,
    rounds: roundPlans,
    accounts,
    totals: {
      reachedClean: score[0],
      reachedRuleBreakers: score[1],
      chasers: accs.filter((a) => !a.exclusion && a.committed < target - EPS).length,
      expectedClanStars: score[2],
    },
  };
}
