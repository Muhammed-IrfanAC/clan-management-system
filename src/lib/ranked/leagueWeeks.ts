/**
 * Finished Ranked weeks from the league history API, as `ranked_league_weeks` rows (migration 050) — PURE.
 *
 * The history does not say which TH the account held each week, and that matters: a tier means far
 * more at a lower TH (attackModel `carriedStanding`). So each week is booked to the TH the account held
 * for most of that week's wars (ties to the lower TH) — an upgrade near the end of a week must not move
 * a league earned at the old TH to the new one — else the TH of its last war before the week, else its
 * TH now.
 */
import type { CoCLeagueHistoryEntry } from '@/lib/coc-api';
import { RANKED_WEEK_SECONDS } from '@/lib/warStats/rankedWeek';

export interface LeagueWeekRow {
  player_tag: string;
  league_season_id: number;
  league_tier_id: number;
  th_level: number | null;
  trophies: number | null;
  placement: number | null;
  attack_wins: number | null;
  attack_losses: number | null;
  defense_wins: number | null;
  defense_losses: number | null;
  defense_stars: number | null;
}

/** The TH held in the week starting at `seasonId` (Unix seconds); see the module comment. */
export function thForWeek(seasonId: number, wars: readonly { at: number; th: number }[], currentTh: number | null): number | null {
  const start = seasonId * 1000;
  const end = (seasonId + RANKED_WEEK_SECONDS) * 1000;
  const count = new Map<number, number>();
  for (const w of wars) if (w.at >= start && w.at < end) count.set(w.th, (count.get(w.th) ?? 0) + 1);
  if (count.size) return [...count].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  let latest: { at: number; th: number } | null = null;
  for (const w of wars) if (w.at < start && (!latest || w.at > latest.at)) latest = w;
  return latest?.th ?? currentTh;
}

export function leagueWeekRows(
  account: { playerTag: string; thLevel: number | null },
  history: readonly CoCLeagueHistoryEntry[],
  wars: readonly { at: number; th: number }[],
): LeagueWeekRow[] {
  return history
    .filter((h) => h.leagueSeasonId && h.leagueTierId)
    .map((h) => ({
      player_tag: account.playerTag,
      league_season_id: h.leagueSeasonId,
      league_tier_id: h.leagueTierId,
      th_level: thForWeek(h.leagueSeasonId, wars, account.thLevel),
      trophies: h.leagueTrophies ?? null,
      placement: h.placement ?? null,
      attack_wins: h.attackWins ?? null,
      attack_losses: h.attackLosses ?? null,
      defense_wins: h.defenseWins ?? null,
      defense_losses: h.defenseLosses ?? null,
      defense_stars: h.defenseStars ?? null,
    }));
}
