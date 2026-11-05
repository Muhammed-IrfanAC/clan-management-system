/**
 * Attack-model ratings (attackModel.ts) for a set of accounts, from their stored war attacks.
 * Server-only.
 *
 * A rating learns from an account's whole war history, with every attack labelled as the model was
 * fitted. The label of one attack depends on every earlier attack on that base in that war, other
 * accounts' included, so the family's attacks over RATING_WINDOW_DAYS are read from both war tables.
 * The pages are read in parallel, and the read is cached for CACHE_MS, so the planner page, its other
 * clans and the Discord lineup post all reuse one read. Ratings themselves are computed per call: they
 * are cheap, and each caller supplies its accounts' current league and TH, the stand-in for attacks
 * stored before migration 048.
 */
import { supabase } from '@/lib/supabase';
import { carriedStanding, CARRY_WEEKS, rateAccounts, ratedHistory, type AccountRating, type StoredAttack, type WeekStanding } from './attackModel';
import { LEAGUE_TIER_ID_BASE } from './leagues';
import type { AttackRecord } from './familyStrength';

/**
 * How far back a rating learns from — and how it keeps up with a player who improved: inside the
 * window every attack counts the same, and an attack older than this drops out. Two months was
 * neutral on held-out weeks against all history (and against gradual forgetting); one month was worse.
 */
export const RATING_WINDOW_DAYS = 60;
const CACHE_MS = 10 * 60_000;
/** PostgREST returns at most this many rows per request. */
const PAGE = 1000;
const COLUMNS = 'round_id, attack_order, attacker_tag, attacker_th, defender_tag, defender_th, stars, first_seen_at, attacker_league_tier_id';

interface AttackHistory {
  regular: StoredAttack[];
  cwl: StoredAttack[];
  /** Regular wars played under a battle modifier (hard mode, handicaps), which the model leaves out. */
  excludedWars: Set<string>;
}

let cache: { at: number; history: Promise<AttackHistory> } | null = null;

async function readTable(table: 'war_attacks' | 'cwl_war_attacks', since: string): Promise<StoredAttack[]> {
  const page = (from: number, count = false) =>
    supabase
      .from(table)
      .select(COLUMNS, count ? { count: 'exact' } : undefined)
      .gte('first_seen_at', since)
      .order('id')
      .range(from, from + PAGE - 1);
  const first = await page(0, true);
  if (first.error) throw first.error;
  const rows = [...((first.data as unknown as StoredAttack[]) || [])];
  const rest: ReturnType<typeof page>[] = [];
  for (let from = PAGE; from < (first.count ?? 0); from += PAGE) rest.push(page(from));
  for (const res of await Promise.all(rest)) {
    if (res.error) throw res.error;
    rows.push(...((res.data as unknown as StoredAttack[]) || []));
  }
  // An attack inserted between the pages can shift a row across a page boundary and be read twice.
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.round_id}:${r.attack_order}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readHistory(): Promise<AttackHistory> {
  const since = new Date(Date.now() - RATING_WINDOW_DAYS * 86_400_000).toISOString();
  const [regular, cwl, modified] = await Promise.all([
    readTable('war_attacks', since),
    readTable('cwl_war_attacks', since),
    supabase.from('war_rounds').select('id').not('battle_modifier', 'is', null).neq('battle_modifier', 'none'),
  ]);
  if (modified.error) throw modified.error;
  return { regular, cwl, excludedWars: new Set(((modified.data as { id: string }[]) || []).map((r) => r.id)) };
}

function history(): Promise<AttackHistory> {
  if (!cache || Date.now() - cache.at > CACHE_MS) {
    const entry = { at: Date.now(), history: readHistory() };
    // A failed read is not cached: the next caller tries again.
    entry.history.catch(() => {
      if (cache === entry) cache = null;
    });
    cache = entry;
  }
  return cache.history;
}

/** An account's carried league standing now, when a recent week beats its current tier. */
export interface LeagueCarry {
  /** The league feature to use in place of the current tier's (attackModel `carriedStanding`). */
  strength: number;
  /** The week it comes from. */
  from: WeekStanding;
}

/** Each account's kept Ranked weeks (ranked_league_weeks) since `sinceMs`, as WeekStanding rows. */
async function loadLeagueWeeks(tags: readonly string[], sinceMs: number): Promise<Map<string, WeekStanding[]>> {
  const out = new Map<string, WeekStanding[]>();
  type Row = { player_tag: string; league_season_id: number; league_tier_id: number; th_level: number | null };
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('ranked_league_weeks')
      .select('player_tag, league_season_id, league_tier_id, th_level')
      .in('player_tag', tags as string[])
      .gte('league_season_id', Math.floor(sinceMs / 1000))
      .order('player_tag')
      .order('league_season_id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data as Row[]) || [];
    for (const r of rows) {
      if (!r.th_level) continue;
      const w = { weekStart: r.league_season_id * 1000, th: r.th_level, tier: r.league_tier_id - LEAGUE_TIER_ID_BASE };
      out.set(r.player_tag, [...(out.get(r.player_tag) ?? []), w]);
    }
    if (rows.length < PAGE) return out;
  }
}

/**
 * Ratings for these accounts, the record behind each, and their carried league standing (a recent
 * week that beats the current tier, e.g. before a TH upgrade). An account with no usable attacks is
 * simply absent from ratings/records (= unrated); one whose current tier is its best has no carry.
 */
export async function loadAccountHistory(
  accounts: readonly { playerTag: string; leagueTier: number | null; thLevel: number }[],
): Promise<{ ratings: Map<string, AccountRating>; records: Map<string, AttackRecord>; carries: Map<string, LeagueCarry> }> {
  if (accounts.length === 0) return { ratings: new Map(), records: new Map(), carries: new Map() };
  const tags = accounts.map((a) => a.playerTag);
  // Weeks for the window's attacks, and the CARRY_WEEKS before the oldest of them.
  const weeksSince = Date.now() - (RATING_WINDOW_DAYS + 7 * (CARRY_WEEKS + 1)) * 86_400_000;
  const [{ regular, cwl, excludedWars }, weeks] = await Promise.all([history(), loadLeagueWeeks(tags, weeksSince)]);
  const tagSet = new Set(tags);
  const attacks = ratedHistory({
    regular,
    cwl,
    excludedWars,
    weeks,
    current: new Map(accounts.map((a) => [a.playerTag, { tier: a.leagueTier, th: a.thLevel || null }] as const)),
  }).filter((a) => tagSet.has(a.attackerTag));
  const records = new Map<string, AttackRecord>();
  for (const a of attacks) {
    const r = records.get(a.attackerTag) ?? { attacks: 0, triples: 0, cwlAttacks: 0, cwlTriples: 0 };
    r.attacks++;
    if (a.tripled) r.triples++;
    if (a.cwl) {
      r.cwlAttacks++;
      if (a.tripled) r.cwlTriples++;
    }
    records.set(a.attackerTag, r);
  }
  const carries = new Map<string, LeagueCarry>();
  const now = Date.now();
  for (const a of accounts) {
    if (!a.thLevel) continue;
    const c = carriedStanding(a.thLevel, a.leagueTier, weeks.get(a.playerTag), now);
    if (c.from) carries.set(a.playerTag, { strength: c.strength, from: c.from });
  }
  return { ratings: rateAccounts(attacks), records, carries };
}

/** Ratings for these accounts; an account with no usable attacks is simply absent (= unrated). */
export async function loadAccountRatings(
  accounts: readonly { playerTag: string; leagueTier: number | null; thLevel: number }[],
): Promise<Map<string, AccountRating>> {
  return (await loadAccountHistory(accounts)).ratings;
}
