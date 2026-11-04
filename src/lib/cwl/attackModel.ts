/**
 * The attack model: the chance that one war attack triples, fitted on the family's own wars.
 *
 * PURE — no I/O. The constants below are produced by `scripts/attack-model/` (fit + time-split
 * evaluation, see its README); refit there rather than hand-editing them.
 *
 *   P(3★) = σ(base + rating)
 *
 *   base    the matchup and the attacker: TH levels hit up or down, the attacker's TH, war type
 *           (CWL is harder than a regular war), whether the base had been hit before, a second
 *           attack, and the Ranked league as a TH-RELATIVE percentile ("top 4% of TH17s") weighted
 *           by how spread out that TH's leagues are (LEAGUE_SPREAD) — the same tier means something
 *           very different at TH15 and at TH18, and "top 1%" is cheap where everyone sits in a few
 *           leagues.
 *   rating  a per-account offset learned from that account's own war results (`rateAccounts`):
 *           an online Bayesian filter, so a new account starts at 0 with wide uncertainty and moves
 *           quickly, an established one moves slowly, and a TH upgrade re-opens the uncertainty.
 *
 * A non-triple scores 2★ or 1★ (0★ is rare) — FAIL_STARS gives its expected value, which only drops
 * for big hit-ups. A PLANNED slot also carries the risk that the attack is never made (RELIABILITY):
 * `slotTripleChance` / `slotExpectedStars` are what the planner and the Strength page use.
 *
 * Why this shape: on held-out weeks (fit on earlier weeks, scored on later ones the fit never saw)
 * the old strength × hit-up table scored a log loss of 0.594, the same table re-fitted 0.436, the
 * base model 0.420 and base + rating 0.415, which also tracked each account's actual stars best.
 * League adds little once a rating exists, but it is what a new account is judged on. Hero levels
 * were tested and added nothing.
 */
import { LEAGUE_TIER_ID_BASE } from './leagues';
import { labelAttacks } from '@/lib/warStats/attackClass';
import { lastEndedWeek, RANKED_WEEK_SECONDS } from '@/lib/warStats/rankedWeek';

/** Logit coefficients. Reference case: a same-TH, fresh, first attack by a TH17 in a regular war. */
// Fitted on 6,458 attacks, 2026-07-15 – 2026-11-04 (prod dump of 2026-11-04).
export const COEFFICIENTS = {
  intercept: 1.2508,
  upDown: 1.6956,
  up1: -0.8166,
  up2: -1.5233,
  up3: -2.2033,
  up4Plus: -3.2476,
  /** TH relative to TH17; TH ≤11 share one group, TH19+ is read as TH18. */
  th: { 11: 0.5418, 12: 0.226, 13: 0.2294, 14: 0.5774, 15: 0.1798, 16: 0.3175, 17: 0, 18: -0.6385 } as Record<number, number>,
  /** Extra drop for TH14 and below hitting two or more levels up (mini-clan reaches). */
  lowThUp2Plus: -1.3113,
  cwl: -0.3658,
  cleanup: -0.5859,
  secondAttack: 0.1195,
  league: 0.5552,
  /**
   * TH18's own league correction. Its leagues are squeezed between a high floor (defences carry a TH18
   * up) and the Legend I ceiling, so the spread weight undersells them; fitted, a TH18 league counts
   * about double (held-out neutral). Without it the best TH18 ranked 12th.
   */
  leagueTh18: 0.55,
  leagueOnHitUp: -0.0627,
  leagueImputed: -0.172,
  imputed: 0.1868,
} as const;

/**
 * The account-rating filter. Variances are in logit units². Tuned on a two-week dev period; the
 * regular-war weight was a near tie between 0.5 and 1 there, i.e. the data cannot yet tell them apart.
 */
export const RATING = {
  priorVariance: 0.2,
  driftPer30Days: 0,
  thUpgradeVariance: 0.3,
  /** How much a regular-war attack counts relative to a CWL attack. */
  regularWarWeight: 0.5,
  /**
   * An account new to our wars underperforms its TH + league in its first attacks (77% tripled vs 83%
   * predicted over the first five, z = −2.9), so its logit starts this much lower and the discount
   * fades with every attack: −newcomerPenalty · e^(−attacks / newcomerFadeAttacks). Counted inside the
   * rating window, so an account with only a few wars in it is discounted too. Held out, it improved
   * the whole test period (log loss 0.4151 → 0.4108) without touching established accounts. This is
   * the ATTACK part — how an attack that is made goes — and the only part the rating learns against.
   */
  newcomerPenalty: 0.6,
  newcomerFadeAttacks: 4,
} as const;

/**
 * The RELIABILITY part: will a planned attack be made at all? An account with few attacks with us
 * misses more — a newcomer's first war misses 22.6% of its attacks against ~11% — and missed attacks
 * also keep an account's count low, so the count is a fair reliability signal. Tuned on war SLOTS
 * (attacks made + attacks missed, a miss scoring no triple): held out, it cut the slot log loss
 * 0.6416 → 0.6050, attack predictions untouched. It enters what a SLOT is expected to yield — the
 * planner and the Strength score — never what the rating learns from, which only ever sees attacks
 * that were made. Combined with the attack part the discount is −1.0 with no record, −0.50 after 6
 * attacks, −0.29 after 20 and −0.15 after 60.
 */
export const RELIABILITY = { penalty: 0.4, fadeAttacks: 60 } as const;

/** Expected stars of a non-triple. */
export const FAIL_STARS = { upToTwo: 1.75, threeOrMore: 1.324 } as const;

/** League strength used when an account's league is not known: a typical family account's. */
export const UNKNOWN_LEAGUE_STRENGTH = 1.043;


/**
 * Players per Ranked tier at each TH (index 0 = tier 1 Skeleton I … index 35 = tier 36 Legend I),
 * from ClashSpot's population chart, Nov 2026. Only the shape matters: it turns a tier into "top x%".
 */
const PLAYERS_BY_TIER: Record<number, readonly number[]> = {
  7: [115797, 49718, 7382, 1014, 81, 12, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  8: [27601, 294464, 153859, 48864, 3719, 450, 164, 70, 12, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  9: [2890, 26651, 425267, 289027, 168760, 83139, 22470, 3927, 909, 132, 13, 12, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  10: [183, 436, 17113, 313147, 217590, 211225, 164459, 96027, 32565, 3823, 195, 170, 34, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  11: [58, 71, 928, 15245, 10833, 436318, 272884, 261282, 242823, 115758, 36660, 18086, 3504, 256, 290, 146, 11, 26, 15, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  12: [9, 3, 29, 196, 61, 11809, 9979, 421000, 368401, 273711, 204723, 188944, 106146, 32372, 20521, 6455, 446, 430, 211, 14, 40, 61, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  13: [5, 4, 10, 56, 13, 615, 305, 11111, 10122, 8712, 618957, 433990, 319738, 222750, 214055, 149466, 70198, 60854, 35327, 6459, 5272, 3227, 141, 171, 178, 8, 6, 6, 2, 0, 0, 0, 0, 0, 0, 0],
  14: [2, 1, 2, 5, 1, 22, 3, 147, 85, 47, 9447, 7983, 6994, 517896, 352132, 242371, 184090, 204382, 158520, 91026, 92334, 77940, 16509, 14389, 10248, 741, 677, 519, 119, 3, 0, 0, 0, 0, 0, 0],
  15: [5, 0, 3, 4, 1, 22, 0, 57, 25, 17, 928, 421, 222, 10340, 6276, 5224, 527417, 333322, 224002, 156531, 221969, 185807, 115473, 122152, 119337, 49062, 49898, 49183, 30085, 8830, 1920, 216, 7, 0, 0, 0],
  16: [1, 2, 0, 1, 0, 4, 1, 10, 1, 0, 49, 18, 9, 180, 43, 23, 6942, 4642, 3434, 481162, 311813, 177601, 127892, 151824, 144615, 97479, 117704, 139944, 125631, 68352, 28266, 5466, 531, 7, 0, 0],
  17: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 3, 1, 1, 23, 19, 12, 4106, 4198, 3265, 422762, 257531, 158265, 132128, 171873, 207500, 218051, 182893, 138606, 66612, 18644, 1624, 6, 0],
  18: [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 2, 2, 0, 11, 9, 4, 3298, 2588, 1978, 495920, 401030, 395043, 401501, 428252, 501783, 457801, 442062, 356772, 90967, 13253],
};

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Standard deviation, in tiers, of a TH's league distribution. */
function tierSpread(counts: readonly number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  const mean = counts.reduce((a, c, i) => a + c * (i + 1), 0) / total;
  return Math.sqrt(counts.reduce((a, c, i) => a + c * (i + 1 - mean) ** 2, 0) / total);
}

/**
 * How spread out each TH's leagues are, relative to TH18. At TH9 nearly everyone sits in a few leagues
 * (SD 1.15 tiers) so a few steps up is already the top 1%; at TH15–18 players spread over ~10 leagues
 * and reaching the top takes many hard steps. The percentile is weighted by this (TH9 ×0.43, TH12
 * ×0.69, TH16 ×1.26, TH18 ×1), which on held-out weeks beat the plain percentile, a standard score and
 * "steps above the median".
 */
export const LEAGUE_SPREAD: Readonly<Record<number, number>> = (() => {
  const ref = tierSpread(PLAYERS_BY_TIER[18]);
  return Object.fromEntries(Object.entries(PLAYERS_BY_TIER).map(([th, c]) => [Number(th), tierSpread(c) / ref]));
})();

/** Share of players at this TH sitting in this tier or above (0–1), or null when unknown/unranked. */
export function leagueTopShare(th: number, tier: number | null | undefined): number | null {
  if (tier == null || tier < 1) return null;
  const counts = PLAYERS_BY_TIER[clamp(Math.round(th), 7, 18)];
  const from = clamp(Math.round(tier), 1, 36) - 1;
  let above = 0;
  let total = 0;
  counts.forEach((c, i) => {
    total += c;
    if (i >= from) above += c;
  });
  return total ? above / total : null;
}

/**
 * The league feature: the TH-relative percentile (−log10 of the top share: 1 = top 10%, 2 = top 1%,
 * capped at 3.5), weighted by how spread out the TH's leagues are (LEAGUE_SPREAD).
 */
export function leagueStrength(th: number, tier: number | null | undefined): number {
  const share = leagueTopShare(th, tier);
  if (share == null) return UNKNOWN_LEAGUE_STRENGTH;
  return Math.min(3.5, -Math.log10(Math.max(share, 1e-6))) * LEAGUE_SPREAD[clamp(Math.round(th), 7, 18)];
}

export interface AttackContext {
  attackerTh: number;
  defenderTh: number;
  /** Ranked tier ordinal (1–36) the attacker was in; null when unknown. */
  leagueTier: number | null;
  cwl: boolean;
  /** The base had been hit before but was still short of three stars. */
  cleanup?: boolean;
  /** The account's second (or later) attack in this war. */
  secondAttack?: boolean;
  /** The league is a stand-in (today's tier for an old attack), not the week's own. */
  leagueImputed?: boolean;
  /**
   * The TH the league tier was observed at, when that is not the attack's own: a stand-in tier is
   * read as a percentile there and carried back to the older attack (see `ratedHistory`).
   */
  leagueTh?: number;
  /** A precomputed league feature (a carried standing, `carriedStanding`) in place of the tier's own. */
  leagueStrength?: number;
}

/** The matchup + attacker part of the logit, before the account's own rating. */
export function baseLogit(ctx: AttackContext): number {
  const c = COEFFICIENTS;
  const up = ctx.defenderTh - ctx.attackerTh;
  const lp = ctx.leagueStrength ?? leagueStrength(ctx.leagueTh ?? ctx.attackerTh, ctx.leagueTier);
  const imputed = ctx.leagueImputed ? 1 : 0;
  let z = c.intercept;
  if (up < 0) z += c.upDown;
  else if (up === 1) z += c.up1;
  else if (up === 2) z += c.up2;
  else if (up === 3) z += c.up3;
  else if (up >= 4) z += c.up4Plus;
  z += c.th[clamp(ctx.attackerTh, 11, 18)] ?? 0;
  if (ctx.attackerTh <= 14 && up >= 2) z += c.lowThUp2Plus;
  if (ctx.cwl) z += c.cwl;
  if (ctx.cleanup) z += c.cleanup;
  if (ctx.secondAttack) z += c.secondAttack;
  const th18 = clamp(ctx.leagueTh ?? ctx.attackerTh, 7, 18) === 18 ? 1 : 0;
  z += c.league * lp + c.leagueTh18 * lp * th18 + c.leagueOnHitUp * lp * (up > 0 ? 1 : 0) + c.leagueImputed * lp * imputed + c.imputed * imputed;
  return z;
}

export interface AccountRating {
  /** Logit offset on top of the base: +0.5 lifts an 86% mirror to ~91%, −0.5 drops it to ~79%. */
  mean: number;
  variance: number;
  /** Attacks the rating has seen. */
  attacks: number;
  lastAt: number | null;
  lastTh: number | null;
}

/** A rating that has seen nothing: the population average, at full prior uncertainty. */
export const UNRATED: AccountRating = Object.freeze({ mean: 0, variance: RATING.priorVariance, attacks: 0, lastAt: null, lastTh: null });

/** The newcomer discount on the logit after this many attacks (see RATING.newcomerPenalty). */
export function newcomerOffset(attacks: number): number {
  return -RATING.newcomerPenalty * Math.exp(-attacks / RATING.newcomerFadeAttacks);
}

/** Chance of a triple, integrating over the rating's uncertainty (probit approximation). */
export function tripleChanceFromLogit(base: number, rating: AccountRating = UNRATED): number {
  return sigmoid((base + rating.mean + newcomerOffset(rating.attacks)) / Math.sqrt(1 + (Math.PI * rating.variance) / 8));
}

export function tripleChance(ctx: AttackContext, rating: AccountRating = UNRATED): number {
  return tripleChanceFromLogit(baseLogit(ctx), rating);
}

export function expectedStars(ctx: AttackContext, rating: AccountRating = UNRATED): number {
  return starsFromTriple(tripleChance(ctx, rating), ctx);
}

const starsFromTriple = (p: number, ctx: AttackContext) =>
  3 * p + (1 - p) * (ctx.defenderTh - ctx.attackerTh >= 3 ? FAIL_STARS.threeOrMore : FAIL_STARS.upToTwo);

/** The reliability discount on the logit after this many attacks (see RELIABILITY). */
export function reliabilityOffset(attacks: number): number {
  return -RELIABILITY.penalty * Math.exp(-attacks / RELIABILITY.fadeAttacks);
}

/**
 * The chance a PLANNED slot yields a triple: the attack's chance, and the chance it is made at all.
 * What the planner fields accounts on and the Strength page shows. (`tripleChance` is the attack
 * alone, which is what the rating learns against.)
 */
export function slotTripleChance(ctx: AttackContext, rating: AccountRating = UNRATED): number {
  return tripleChanceFromLogit(baseLogit(ctx) + reliabilityOffset(rating.attacks), rating);
}

/** Expected stars of a planned slot (a miss is folded into the non-triple share). */
export function slotExpectedStars(ctx: AttackContext, rating: AccountRating = UNRATED): number {
  return starsFromTriple(slotTripleChance(ctx, rating), ctx);
}

/** The chance a same-TH CWL slot yields a triple — the headline number for an attacker. */
export function mirrorChance(thLevel: number, leagueTier: number | null, rating: AccountRating = UNRATED, league?: number): number {
  return slotTripleChance({ attackerTh: thLevel, defenderTh: thLevel, leagueTier, cwl: true, leagueStrength: league }, rating);
}

/** One finished Ranked week of an account: its tier, and the TH it held that week. */
export interface WeekStanding {
  /** The week's start (ms), a Monday 05:00 UTC. */
  weekStart: number;
  th: number;
  tier: number;
}

/** How many finished weeks a standing is carried for. */
export const CARRY_WEEKS = 8;
const WEEK_MS = RANKED_WEEK_SECONDS * 1000;

/**
 * The league feature, carried. A tier carries over a TH upgrade but is far rarer at the old TH — Legend
 * III is the top 0.08% of TH17s and the top 11.5% of TH18s — and a league moves week to week. So the
 * feature is the BEST standing among the CARRY_WEEKS finished weeks before `at`, each read at the TH
 * held that week and compared by its league part (`leagueWeight` × `leagueStrength`), or the own tier's
 * if better; returned as a value at `readTh`, with the week it came from (null = the own tier won).
 * Held out it improved dev 0.3462 → 0.3431, test neutral.
 */
export function carriedStanding(
  readTh: number,
  tier: number | null,
  weeks: readonly WeekStanding[] | undefined,
  at: number,
): { strength: number; from: WeekStanding | null } {
  const own = leagueStrength(readTh, tier);
  let best = leagueWeight(readTh) * own;
  let from: WeekStanding | null = null;
  const thisWeek = lastEndedWeek(new Date(at)).end.getTime();
  for (const w of weeks ?? []) {
    if (w.tier <= 0 || !w.th || w.weekStart >= thisWeek || w.weekStart < thisWeek - CARRY_WEEKS * WEEK_MS) continue;
    const part = leagueWeight(w.th) * leagueStrength(w.th, w.tier);
    if (part > best) {
      best = part;
      from = w;
    }
  }
  return { strength: from ? best / leagueWeight(readTh) : own, from };
}

/** What one unit of league strength is worth on a mirror at this TH (TH18 carries its own correction). */
export function leagueWeight(thLevel: number): number {
  return COEFFICIENTS.league + (clamp(thLevel, 7, 18) === 18 ? COEFFICIENTS.leagueTh18 : 0);
}

/** Display label for an attacker, cut on the live family ranking (familyStrength.ts). */
export type SkillTier = 'goat' | 'strong' | 'medium' | 'weak';

/**
 * How good an attacker is FOR THEIR TOWN HALL: the league's share of the logit plus the account's
 * rating and both discounts for few wars with us — everything in the model except the TH and the matchup. Comparable across THs, which the
 * mirror chance is not (a TH18 mirror is harder than a TH16 one for everybody).
 */
export function attackerSkill(thLevel: number, leagueTier: number | null, rating: AccountRating = UNRATED, league?: number): number {
  return leagueWeight(thLevel) * (league ?? leagueStrength(thLevel, leagueTier)) + rating.mean + newcomerOffset(rating.attacks) + reliabilityOffset(rating.attacks);
}


/**
 * One attack through the rating filter: returns what was predicted BEFORE the result was known, and
 * the rating after it. Time passing widens the variance (drift), as does a TH change — never past
 * the prior. The update is the Laplace step of a logistic model, weighted by war type.
 */
export function stepRating(
  rating: AccountRating,
  base: number,
  attack: { tripled: boolean; at: number; attackerTh: number; cwl: boolean },
): { predicted: number; rating: AccountRating } {
  let v = rating.variance;
  if (rating.lastAt != null) {
    v = Math.min(RATING.priorVariance, v + (RATING.driftPer30Days * (attack.at - rating.lastAt)) / (30 * 86_400_000));
    if (rating.lastTh != null && attack.attackerTh !== rating.lastTh) v = Math.min(RATING.priorVariance, v + RATING.thUpgradeVariance);
  }
  const predicted = tripleChanceFromLogit(base, { ...rating, variance: v });
  const p0 = sigmoid(base + rating.mean + newcomerOffset(rating.attacks));
  const w = attack.cwl ? 1 : RATING.regularWarWeight;
  const vNew = 1 / (1 / v + w * p0 * (1 - p0));
  return {
    predicted,
    rating: {
      mean: rating.mean + vNew * w * ((attack.tripled ? 1 : 0) - p0),
      variance: vNew,
      attacks: rating.attacks + 1,
      lastAt: attack.at,
      lastTh: attack.attackerTh,
    },
  };
}

export interface RatedAttack extends AttackContext {
  attackerTag: string;
  /** When the attack was first seen (ms). */
  at: number;
  tripled: boolean;
}

/** Rate every account from its war history (any order — processed oldest first). */
export function rateAccounts(attacks: readonly RatedAttack[]): Map<string, AccountRating> {
  const ratings = new Map<string, AccountRating>();
  const ordered = attacks.map((a, i) => ({ a, i })).sort((x, y) => x.a.at - y.a.at || x.i - y.i);
  for (const { a } of ordered) {
    const step = stepRating(ratings.get(a.attackerTag) ?? UNRATED, baseLogit(a), a);
    ratings.set(a.attackerTag, step.rating);
  }
  return ratings;
}

/** An attack row as stored in `war_attacks` / `cwl_war_attacks`. */
export interface StoredAttack {
  round_id: string;
  attack_order: number;
  attacker_tag: string;
  attacker_th: number | null;
  defender_tag: string;
  defender_th: number | null;
  stars: number;
  first_seen_at: string;
  /** Raw API tier id at the first sighting (migration 048); null for older rows. */
  attacker_league_tier_id?: number | null;
}

/**
 * Stored attack rows → the history the rating learns from, with the same rules the model was fitted
 * under: hits on an already-tripled base are dropped (nothing was left to win — they are loot hits),
 * a base that had been hit before is a cleanup, an account's later attacks in the same war are
 * marked, wars in `excludedWars` (battle modifiers such as hard mode) are skipped, and so are
 * unranked attackers.
 *
 * An attack with no stored league (older than migration 048) takes its week's tier from `weeks`
 * (ranked_league_weeks, migration 050) when that week is kept; otherwise the account's tier today,
 * flagged as imputed — read as a percentile at TODAY's TH and carried back. Either way the league
 * feature is then the carried standing (`carriedStanding`) of the weeks before the attack. An account that
 * has upgraded since would otherwise have today's tier read at its old, lower TH, where the same tier
 * is a far higher percentile (Electro 33 is the top 0.03% of TH16s): the model would expect near
 * certain triples and mark every old miss as underperformance.
 */
export function ratedHistory(params: {
  regular: readonly StoredAttack[];
  cwl: readonly StoredAttack[];
  /** Each account's Ranked tier ordinal and TH now — the stand-in for attacks stored without a tier. */
  current: ReadonlyMap<string, { tier: number | null; th: number | null }>;
  /** Each account's finished Ranked weeks (ranked_league_weeks). */
  weeks?: ReadonlyMap<string, readonly WeekStanding[]>;
  excludedWars?: ReadonlySet<string>;
}): RatedAttack[] {
  const out: RatedAttack[] = [];
  const ordinal = (id: number | null | undefined) => (id ? id - LEAGUE_TIER_ID_BASE : null);
  for (const [rows, cwl] of [[params.regular, false], [params.cwl, true]] as const) {
    const byWar = new Map<string, StoredAttack[]>();
    for (const r of rows) {
      if (params.excludedWars?.has(r.round_id)) continue;
      const list = byWar.get(r.round_id) ?? [];
      list.push(r);
      byWar.set(r.round_id, list);
    }
    for (const war of byWar.values()) {
      const seen = new Map<string, number>();
      const labelled = labelAttacks(war.map((r) => ({ ...r, order: r.attack_order, defenderTag: r.defender_tag })));
      for (const a of labelled) {
        const nth = seen.get(a.attacker_tag) ?? 0;
        seen.set(a.attacker_tag, nth + 1);
        if (a.kind === 'dead' || a.attacker_th == null || a.defender_th == null) continue;
        const at = Date.parse(a.first_seen_at);
        const weeks = params.weeks?.get(a.attacker_tag);
        const stored = ordinal(a.attacker_league_tier_id);
        const ofWeek = stored == null ? weeks?.find((w) => w.weekStart === lastEndedWeek(new Date(at)).end.getTime()) : undefined;
        const now = params.current.get(a.attacker_tag);
        const tier = stored ?? ofWeek?.tier ?? now?.tier ?? null;
        if (tier != null && tier <= 0) continue; // unranked
        const imputed = stored == null && !ofWeek;
        const leagueTh = imputed && now?.th ? now.th : a.attacker_th;
        out.push({
          attackerTag: a.attacker_tag,
          at,
          tripled: a.stars === 3,
          attackerTh: a.attacker_th,
          defenderTh: a.defender_th,
          leagueTier: tier,
          leagueImputed: imputed,
          leagueStrength: carriedStanding(leagueTh, tier, weeks, at).strength,
          ...(leagueTh !== a.attacker_th ? { leagueTh } : {}),
          cwl,
          cleanup: a.kind === 'cleanup',
          secondAttack: nth >= 1,
        });
      }
    }
  }
  return out;
}
