/**
 * DB/send half of the weekly stats post, run as a step of `runFullSync`.
 *
 * Every sync after a Ranked League week ends (Monday 05:00 UTC) checks which active clans have not had
 * that week's report yet, and posts it for them. The decisions live in the pure modules: the week
 * arithmetic and the Ranked roll-up in `rankedWeek.ts`, the war roll-up in `summary.ts`, the message in
 * `statsPost.ts`. `weekly_stats_posts` (migration 045) records one row per clan per week, so the
 * five-minute cron does not post twelve reports an hour.
 *
 * Timing: the step waits half an hour after the reset for the game to publish the week's results, and
 * gives up a day after it — a report arriving on Wednesday about last week reads as a broken bot. If
 * none of a clan's members have results yet, it waits up to three hours before posting without the
 * league section.
 *
 * It goes to the clan channel (purpose 'default') because the report is about one clan and is read by
 * its members, like the strike and lineup posts. It pings nobody.
 *
 * Fail-safe per clan: a clan whose data cannot be read has its claim released and is retried on the
 * next sync, while the other clans still get their reports. A failed DB read is never papered over —
 * a report built from half the data would put wrong numbers in front of the whole clan.
 */

import { supabase } from '@/lib/supabase';
import { destinationForClan, postDiscordMessage, type DiscordMessage } from '@/lib/discord';
import { loadClanWarWindow } from './load';
import { loadRankedWeek } from './rankedLoad';
import { awaitingResults, lastEndedWeek, weeklyPostDue, type RankedWeek } from './rankedWeek';
import { renderWeeklyStats } from './statsPost';
import { summarizeWars } from './summary';

/** Leave this much of the sync's budget unused rather than start another clan's report. */
const CLAN_BUDGET_MS = 12_000;

export type WeeklyBuild = {
  /** Null when the clan has neither wars nor league results to report. */
  message: DiscordMessage | null;
  wars: number;
  skipped: number;
  /** Accounts with league results for the week. */
  played: number;
};

/** The message a clan's report for `week` would send. Throws on a failed read. */
export async function buildWeeklyStats(clanId: string, week: RankedWeek): Promise<WeeklyBuild> {
  const [{ data: clan, error }, window, ranked] = await Promise.all([
    supabase.from('clans').select('display_name').eq('id', clanId).maybeSingle(),
    loadClanWarWindow(clanId),
    loadRankedWeek(clanId, week),
  ]);
  if (error) throw error;

  const played = ranked?.summary.played ?? 0;
  const summary = window.wars.length ? summarizeWars(window.wars) : null;
  const base = { wars: summary?.wars ?? 0, skipped: window.skipped, played };
  if (!summary && !played) return { message: null, ...base };

  const message = renderWeeklyStats({
    clanName: clan?.display_name || 'Clan',
    summary,
    skipped: window.skipped,
    ranked: played ? ranked : null,
  });
  return { message, ...base };
}

type ClanOutcome = 'sent' | 'empty' | 'waiting' | 'send_failed' | 'error' | 'taken';

async function release(clanId: string, week: RankedWeek) {
  const { error } = await supabase
    .from('weekly_stats_posts')
    .delete()
    .eq('clan_id', clanId)
    .eq('league_season_id', week.seasonId);
  if (error) console.error('Weekly stats: releasing claim failed:', error);
}

async function settle(clanId: string, week: RankedWeek, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from('weekly_stats_posts')
    .update(patch)
    .eq('clan_id', clanId)
    .eq('league_season_id', week.seasonId);
  if (error) console.error('Weekly stats: settling claim failed:', error);
}

async function postClanWeek(clanId: string, week: RankedWeek, now: Date): Promise<ClanOutcome> {
  const claim = await supabase.from('weekly_stats_posts').insert({ clan_id: clanId, league_season_id: week.seasonId });
  if (claim.error) {
    if (claim.error.code === '23505') return 'taken';
    throw claim.error;
  }

  let built: WeeklyBuild;
  try {
    built = await buildWeeklyStats(clanId, week);
  } catch (err) {
    console.error(`Weekly stats for clan ${clanId} failed (retried next sync):`, err);
    await release(clanId, week);
    return 'error';
  }

  if (awaitingResults(now, week, built.played)) {
    await release(clanId, week);
    return 'waiting';
  }
  if (!built.message) {
    await settle(clanId, week, { outcome: 'empty' });
    return 'empty';
  }

  const sent = await postDiscordMessage(built.message, await destinationForClan(clanId));
  if (!sent) {
    await release(clanId, week);
    return 'send_failed';
  }
  await settle(clanId, week, { outcome: 'sent', channel_id: sent.channelId, message_id: sent.messageId });
  return 'sent';
}

/**
 * Post the last league week's report for every active clan that has not had it. Returns null outside
 * the posting window, else the week and what happened per clan. Stops starting new clans near
 * `deadline`; the rest are picked up by the next sync.
 */
export async function postWeeklyStats({ now = new Date(), deadline = Infinity }: { now?: Date; deadline?: number } = {}) {
  const week = lastEndedWeek(now);
  if (!weeklyPostDue(now, week)) return null;

  const [clans, stamps] = await Promise.all([
    supabase.from('clans').select('id').eq('active', true),
    supabase.from('weekly_stats_posts').select('clan_id').eq('league_season_id', week.seasonId),
  ]);
  if (clans.error) throw clans.error;
  if (stamps.error) throw stamps.error;

  const done = new Set(((stamps.data as { clan_id: string }[]) || []).map((s) => s.clan_id));
  const pending = ((clans.data as { id: string }[]) || []).filter((c) => !done.has(c.id));

  const results: Record<string, ClanOutcome> = {};
  for (const clan of pending) {
    if (Date.now() > deadline - CLAN_BUDGET_MS) break;
    results[clan.id] = await postClanWeek(clan.id, week, now);
  }
  return { week: week.seasonId, results };
}
