/**
 * DB/API half of the Ranked League week: the clan's active accounts, each one's league history and
 * battle log, rolled up by the pure `rankedWeek.ts`.
 *
 * Two CoC calls per account, a few at a time so one clan's report does not burst the API. An account
 * whose history cannot be read is left out and counted as `unread`, rather than read as "did not
 * play" — that would quietly drop a member from the report. A failed battle log only costs that
 * account its offence ranking. If most of the roster fails, the API is down, and the load throws so
 * the post is retried on a later sync instead of going out nearly empty.
 */

import { supabase } from '@/lib/supabase';
import { fetchBattleLog, fetchLeagueHistory } from '@/lib/coc-api';
import { summarizeRankedWeek, type RankedAccountInput, type RankedWeek, type RankedWeekSummary } from './rankedWeek';

const CONCURRENCY = 8;

type AccountRow = { player_tag: string; in_game_name: string | null; th_level: number | null; league_tier_id: number | null };

/** Run `fn` over `items`, at most `limit` at once, keeping order. */
async function mapPooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function readAccount(row: AccountRow, week: RankedWeek): Promise<RankedAccountInput | null> {
  const [history, battles] = await Promise.all([
    fetchLeagueHistory(row.player_tag).catch(() => undefined),
    fetchBattleLog(row.player_tag).catch(() => null),
  ]);
  if (history === undefined) return null;
  return {
    tag: row.player_tag,
    name: row.in_game_name,
    th: row.th_level,
    currentTierId: row.league_tier_id,
    week: history?.find((h) => h.leagueSeasonId === week.seasonId) ?? null,
    battles,
  };
}

export type RankedWeekLoad = { summary: RankedWeekSummary; unread: number };

/** The clan's Ranked League week, or null when the clan has no active accounts. */
export async function loadRankedWeek(clanId: string, week: RankedWeek): Promise<RankedWeekLoad | null> {
  const { data, error } = await supabase
    .from('player_accounts')
    .select('player_tag, in_game_name, th_level, league_tier_id')
    .eq('clan_id', clanId)
    .eq('status', 'active');
  if (error) throw error;
  const rows = (data as AccountRow[]) || [];
  if (!rows.length) return null;

  const read = await mapPooled(rows, CONCURRENCY, (r) => readAccount(r, week));
  const inputs = read.filter((r): r is RankedAccountInput => r !== null);
  const unread = rows.length - inputs.length;
  if (unread > rows.length / 2) throw new Error(`League history unreadable for ${unread} of ${rows.length} accounts`);
  return { summary: summarizeRankedWeek(inputs, week), unread };
}
