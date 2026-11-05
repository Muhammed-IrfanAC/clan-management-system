/**
 * The family strength ranking (familyStrength.ts) over every account in a family clan now, every
 * account signed up for a running CWL in one of our clans, and any account away from the family that
 * played AWAY_MIN_WARS+ wars with us in the last AWAY_WINDOW_DAYS,
 * with the ratings and records from their war history (ratingLoad.ts). Server-only.
 *
 * Behind the Strength page, and the source of the label cuts the CWL planner uses, so a label means
 * the same on both: goat is one of the family's top five wherever it is shown.
 */
import { supabase } from '@/lib/supabase';
import { normalizeLeagueTier } from './leagues';
import { AWAY_MIN_WARS, AWAY_WINDOW_DAYS, onLeaderboard, rankFamily, type FamilyRanking, type FamilyStrengthAccount } from './familyStrength';
import { loadAccountHistory } from './ratingLoad';

type AccountRow = {
  player_tag: string;
  in_game_name: string | null;
  th_level: number | null;
  league: string | null;
  league_tier_id: number | null;
  clan_id: string | null;
  person_id: string | null;
  status: string | null;
  person: { display_name: string } | null;
  clan: { display_name: string } | null;
};

const ACCOUNT_SELECT = 'player_tag, in_game_name, th_level, league, league_tier_id, clan_id, person_id, status, person:persons(display_name), clan:clans(display_name)';
/** PostgREST returns at most this many rows per request. */
const PAGE = 1000;
const CACHE_MS = 10 * 60_000;
let warsCache: { at: number; counts: Promise<Map<string, number>> } | null = null;

/** Every row of a paged read. */
async function readAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data as T[]) || [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Wars each account played with us (regular + CWL rounds) in the last AWAY_WINDOW_DAYS; cached. */
export function recentWarCounts(): Promise<Map<string, number>> {
  if (warsCache && Date.now() - warsCache.at <= CACHE_MS) return warsCache.counts;
  const since = new Date(Date.now() - AWAY_WINDOW_DAYS * 86_400_000).toISOString();
  type Row = { player_tag: string; round_id: string };
  const counts = Promise.all([
    readAll<Row>((from, to) =>
      supabase.from('war_members').select('player_tag, round_id, round:war_rounds!inner(start_time)').gte('round.start_time', since).order('id').range(from, to),
    ),
    readAll<Row>((from, to) =>
      supabase.from('cwl_war_members').select('player_tag, round_id, round:cwl_rounds!inner(start_time)').gte('round.start_time', since).order('id').range(from, to),
    ),
  ]).then(([regular, cwl]) => {
    const wars = new Map<string, Set<string>>();
    for (const r of [...regular, ...cwl]) wars.set(r.player_tag, (wars.get(r.player_tag) ?? new Set()).add(r.round_id));
    return new Map([...wars].map(([tag, set]) => [tag, set.size] as const));
  });
  const entry = { at: Date.now(), counts };
  counts.catch(() => {
    if (warsCache === entry) warsCache = null;
  });
  warsCache = entry;
  return counts;
}

/** Every account signed up (the game's own list) for a CWL that is still running in one of our clans. */
export async function cwlSignupTags(): Promise<Set<string>> {
  const { data: seasons, error } = await supabase.from('cwl_seasons').select('id').neq('status', 'completed');
  if (error) throw error;
  const ids = ((seasons as { id: string }[]) || []).map((s) => s.id);
  if (ids.length === 0) return new Set();
  const { data, error: groupErr } = await supabase.from('cwl_group_clans').select('members').in('season_id', ids).eq('is_own', true);
  if (groupErr) throw groupErr;
  return new Set(((data as { members: { tag: string }[] }[]) || []).flatMap((g) => g.members.map((m) => m.tag)));
}

export async function loadFamilyStrength(): Promise<FamilyRanking & { accounts: FamilyStrengthAccount[] }> {
  const [wars, signups] = await Promise.all([recentWarCounts(), cwlSignupTags()]);
  // In a family clan now, signed up for a running CWL, or away with AWAY_MIN_WARS+ recent wars (onLeaderboard).
  const awayTags = [...new Set([...[...wars].filter(([, n]) => n >= AWAY_MIN_WARS).map(([tag]) => tag), ...signups])];
  const [activeRes, awayRes] = await Promise.all([
    supabase.from('player_accounts').select(ACCOUNT_SELECT).eq('status', 'active'),
    awayTags.length
      ? supabase.from('player_accounts').select(ACCOUNT_SELECT).in('player_tag', awayTags).neq('status', 'active')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (activeRes.error) throw activeRes.error;
  if (awayRes.error) throw awayRes.error;
  const rows = [...((activeRes.data as unknown as AccountRow[]) || []), ...((awayRes.data as unknown as AccountRow[]) || [])]
    .map((a) => ({
      playerTag: a.player_tag,
      name: a.in_game_name || a.player_tag,
      personId: a.person_id,
      personName: a.person?.display_name ?? null,
      clanId: a.clan_id,
      clanName: a.clan?.display_name ?? null,
      thLevel: a.th_level ?? 0,
      leagueTier: normalizeLeagueTier(a.league, a.league_tier_id),
      inFamily: a.status === 'active',
      recentWars: wars.get(a.player_tag) ?? 0,
      cwlSignup: signups.has(a.player_tag),
    }))
    .filter(onLeaderboard);
  const { ratings, records, carries } = await loadAccountHistory(rows);
  const ranked = rankFamily(
    rows.map((r) => {
      const c = carries.get(r.playerTag);
      return { ...r, rating: ratings.get(r.playerTag) ?? null, leagueCarry: c ? { strength: c.strength, weekStart: c.from.weekStart, th: c.from.th, tier: c.from.tier } : null };
    }),
  );
  return {
    cuts: ranked.cuts,
    goats: ranked.goats,
    accounts: ranked.accounts.map(({ rating, ...a }) => ({
      ...a,
      rating: rating && rating.attacks > 0 ? { mean: rating.mean, attacks: rating.attacks } : null,
      record: records.get(a.playerTag) ?? null,
    })),
  };
}

/** The ranking without its rows, for the planner's labels. */
export async function loadFamilyRanking(): Promise<FamilyRanking> {
  const { cuts, goats } = await loadFamilyStrength();
  return { cuts, goats };
}
