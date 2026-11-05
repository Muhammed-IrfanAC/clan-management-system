/**
 * The family-wide strength ranking — PURE.
 *
 * Every active family account is ranked by its attack-model skill (attackModel `attackerSkill`: its
 * league as a share of its TH plus its own war-record rating, so a TH18 and a TH15 are compared fairly)
 * and the labels are cut on that ranking:
 *   goat    the GOAT_COUNT best accounts in the whole family — deliberately a handful, not a share
 *   strong  the rest of the top STRONG_SHARE
 *   weak    the bottom WEAK_SHARE
 *   medium  everyone between
 * The cuts are returned as skill thresholds so the CWL planner, which only sees one clan's roster,
 * labels its accounts exactly as this ranking does. Labels only — nothing is planned from them.
 */
import { attackerSkill, leagueTopShare, mirrorChance, UNRATED, type AccountRating, type SkillTier } from './attackModel';
import { isUnranked } from './leagues';

export const GOAT_COUNT = 5;
export const STRONG_SHARE = 0.25;
export const WEAK_SHARE = 0.25;

/**
 * Who is ranked: every account in a family clan now; every account signed up for a CWL that is still
 * running in one of our clans, so the planner labels its whole roster from the same ranking; and any
 * account that played at least AWAY_MIN_WARS wars with us (regular or CWL rounds) in the last
 * AWAY_WINDOW_DAYS — members routinely visit other clans for a while, and a regular who is away this
 * week is still one of ours.
 */
export const AWAY_MIN_WARS = 7;
export const AWAY_WINDOW_DAYS = 30;

export function onLeaderboard(a: { inFamily: boolean; recentWars: number; cwlSignup?: boolean }): boolean {
  return a.inFamily || !!a.cwlSignup || a.recentWars >= AWAY_MIN_WARS;
}

/** Inclusive skill floors: goat ≥ goatFrom, strong ≥ strongFrom, medium ≥ mediumFrom, else weak. */
export interface SkillCuts {
  goatFrom: number;
  strongFrom: number;
  mediumFrom: number;
}

/**
 * Only for when no family ranking is supplied (unit tests): the cuts the live family produced on
 * the prod data of 2026-11-04. The app always ranks the live family.
 */
export const FALLBACK_SKILL_CUTS: SkillCuts = { goatFrom: 1.91, strongFrom: 0.98, mediumFrom: -0.14 };

export function familyCuts(skills: readonly number[]): SkillCuts {
  const s = [...skills].sort((a, b) => b - a);
  const n = s.length;
  if (n === 0) return FALLBACK_SKILL_CUTS;
  const strong = Math.max(1, Math.round(n * STRONG_SHARE));
  const weak = Math.round(n * WEAK_SHARE);
  return {
    goatFrom: s[Math.min(GOAT_COUNT, n) - 1],
    strongFrom: s[Math.min(strong, n) - 1],
    // The weakest account that is not in the bottom share.
    mediumFrom: s[Math.max(0, n - weak - 1)],
  };
}

export function skillTier(skill: number, cuts: SkillCuts = FALLBACK_SKILL_CUTS): SkillTier {
  if (skill >= cuts.goatFrom) return 'goat';
  if (skill >= cuts.strongFrom) return 'strong';
  if (skill >= cuts.mediumFrom) return 'medium';
  return 'weak';
}

/** The family ranking as another page needs it: the label cuts and who the goats are. */
export interface FamilyRanking {
  cuts: SkillCuts;
  /** The GOAT_COUNT best accounts of the ranking — goat is membership, not a threshold. */
  goats: readonly string[];
}

/**
 * The label of an account on a page that shows accounts the ranking may not hold — the CWL planner
 * plans the signup list, which can include an account that has since left the family or was never
 * synced. Such an account is rated with the same skill, but it is not one of the family's top five,
 * so however high its skill it reads strong, never goat; a goat of the ranking stays goat.
 */
export function rankedTier(playerTag: string, skill: number, ranking?: FamilyRanking): SkillTier {
  if (!ranking) return skillTier(skill);
  if (ranking.goats.includes(playerTag)) return 'goat';
  const tier = skillTier(skill, ranking.cuts);
  return tier === 'goat' ? 'strong' : tier;
}

export interface StrengthInput {
  playerTag: string;
  thLevel: number;
  leagueTier: number | null;
  rating?: AccountRating | null;
  /** A carried league standing (attackModel `carriedStanding`) used in place of the current tier's. */
  leagueCarry?: LeagueCarryView | null;
}

/** A carried standing as pages show it: the feature value, and the week, TH and tier it comes from. */
export interface LeagueCarryView {
  strength: number;
  weekStart: number;
  th: number;
  tier: number;
}

export interface StrengthFields {
  /** 1 = the family's best; null when unranked (not rated at all). */
  rank: number | null;
  skill: number | null;
  tier: SkillTier | null;
  /** Chance of tripling a same-TH base in CWL. */
  mirrorChance: number | null;
  /** Share of players at this TH in the account's league or above (0–1). */
  leagueShare: number | null;
}

/** What an account actually did in the attacks its rating learned from. */
export interface AttackRecord {
  attacks: number;
  triples: number;
  cwlAttacks: number;
  cwlTriples: number;
}

/** One row of the family ranking as the Strength page shows it (built by familyStrengthLoad.ts). */
export interface FamilyStrengthAccount extends StrengthFields {
  playerTag: string;
  name: string;
  personId: string | null;
  personName: string | null;
  clanId: string | null;
  clanName: string | null;
  thLevel: number;
  leagueTier: number | null;
  /** In a family clan now; false = away, ranked for its recent wars with us (`clanName` is its last clan). */
  inFamily: boolean;
  /** Wars with us (regular + CWL rounds) in the last AWAY_WINDOW_DAYS. */
  recentWars: number;
  /** Signed up for a CWL still running in one of our clans. */
  cwlSignup: boolean;
  /** The war-record rating (logit offset on top of what TH + league predict); null = no history. */
  rating: { mean: number; attacks: number } | null;
  record: AttackRecord | null;
  /** A recent week that beats the current tier (e.g. before a TH upgrade), when there is one. */
  leagueCarry: LeagueCarryView | null;
}

/** Rank the family, best first; unranked accounts follow, unrated. */
export function rankFamily<T extends StrengthInput>(accounts: readonly T[]): FamilyRanking & { accounts: (T & StrengthFields)[] } {
  const ranked = accounts
    .filter((a) => !isUnranked(a.leagueTier))
    .map((a) => ({ a, skill: attackerSkill(a.thLevel, a.leagueTier, a.rating ?? UNRATED, a.leagueCarry?.strength) }))
    .sort((x, y) => y.skill - x.skill || x.a.playerTag.localeCompare(y.a.playerTag));
  const cuts = familyCuts(ranked.map((r) => r.skill));
  const out: (T & StrengthFields)[] = ranked.map(({ a, skill }, i) => ({
    ...a,
    rank: i + 1,
    skill,
    tier: skillTier(skill, cuts),
    mirrorChance: mirrorChance(a.thLevel, a.leagueTier, a.rating ?? UNRATED, a.leagueCarry?.strength),
    leagueShare: leagueTopShare(a.thLevel, a.leagueTier),
  }));
  for (const a of accounts) {
    if (isUnranked(a.leagueTier)) out.push({ ...a, rank: null, skill: null, tier: null, mirrorChance: null, leagueShare: null });
  }
  return { cuts, goats: out.filter((a) => a.tier === 'goat').map((a) => a.playerTag), accounts: out };
}
