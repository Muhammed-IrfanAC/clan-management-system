/**
 * Ranked League attacks from a battle log, as `ranked_attacks` rows (migration 049) — PURE.
 *
 * The battle log mixes Ranked and multiplayer battles, attacks and defences; only Ranked attacks are
 * kept. It does not carry the attacker's TH or league, so both come from the account as synced now:
 * the TH is right unless the account upgraded within the log's few days, and the league tier is
 * recorded only for battles in the CURRENT Ranked week — a battle from before the Monday reset was
 * fought in a tier the account may no longer hold, so it is stored without one rather than with a
 * wrong one.
 */
import type { CoCBattle } from '@/lib/coc-api';
import { parseCoCTime } from '@/lib/cocTime';
import { lastEndedWeek } from '@/lib/warStats/rankedWeek';

export interface RankedAttackRow {
  player_tag: string;
  battle_at: string;
  opponent_tag: string;
  opponent_name: string | null;
  opponent_th: number | null;
  attacker_th: number | null;
  attacker_league_tier_id: number | null;
  stars: number;
  destruction: number;
  duration_seconds: number | null;
  army_share_code: string | null;
}

export function rankedAttackRows(
  account: { playerTag: string; thLevel: number | null; leagueTierId: number | null },
  battles: readonly CoCBattle[],
  now: Date,
): RankedAttackRow[] {
  const weekStart = lastEndedWeek(now).end.getTime();
  const rows: RankedAttackRow[] = [];
  for (const b of battles) {
    if (b.battleType !== 'ranked' || !b.attack || !b.opponentPlayerTag) continue;
    const at = parseCoCTime(b.battleTimestamp);
    if (!at) continue;
    rows.push({
      player_tag: account.playerTag,
      battle_at: at,
      opponent_tag: b.opponentPlayerTag,
      opponent_name: b.opponentName ?? null,
      opponent_th: b.opponentTownHallLevel ?? null,
      attacker_th: account.thLevel,
      attacker_league_tier_id: Date.parse(at) >= weekStart ? account.leagueTierId : null,
      stars: b.stars,
      destruction: b.destructionPercentage,
      duration_seconds: b.battleTime ?? null,
      army_share_code: b.armyShareCode ?? null,
    });
  }
  return rows;
}
