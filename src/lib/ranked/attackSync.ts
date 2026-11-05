import { supabase } from '@/lib/supabase';
import { fetchBattleLog } from '@/lib/coc-api';
import { rankedAttackRows, type RankedAttackRow } from './attacks';

/**
 * Store the Ranked attacks of every active family account (`ranked_attacks`, migration 049) — a step
 * of the full sync, building up data a later attack model can learn from.
 *
 * The battle log is one CoC call per account and reaches back as little as 40 hours, so each account
 * is re-read once its last read is older than REFRESH_AFTER_MS — comfortably inside that — oldest
 * first, and only while the sync's deadline allows; whatever is left is picked up by the next sync.
 * Rows are inserted ON CONFLICT DO NOTHING, so re-reading a log only adds the attacks it has not
 * seen. An account whose log could not be read keeps its old check time and is retried next run.
 */
export const REFRESH_AFTER_MS = 6 * 60 * 60_000;
const CONCURRENCY = 5;
const CHUNK = 500;

type AccountRow = { player_tag: string; th_level: number | null; league_tier_id: number | null; battle_log_checked_at: string | null };

export async function syncRankedAttacks(opts: { deadline: number; now?: Date }): Promise<{ checked: number; stored: number; remaining: number }> {
  const now = opts.now ?? new Date();
  const { data, error } = await supabase
    .from('player_accounts')
    .select('player_tag, th_level, league_tier_id, battle_log_checked_at')
    .eq('status', 'active');
  if (error) throw error;

  const staleBefore = now.getTime() - REFRESH_AFTER_MS;
  const due = ((data as AccountRow[]) || [])
    .filter((a) => !a.battle_log_checked_at || new Date(a.battle_log_checked_at).getTime() < staleBefore)
    .sort((a, b) => (a.battle_log_checked_at ?? '').localeCompare(b.battle_log_checked_at ?? ''));

  const checked: string[] = [];
  const rows: RankedAttackRow[] = [];
  let next = 0;
  const worker = async () => {
    while (next < due.length && Date.now() < opts.deadline) {
      const a = due[next++];
      try {
        const battles = await fetchBattleLog(a.player_tag);
        rows.push(...rankedAttackRows({ playerTag: a.player_tag, thLevel: a.th_level, leagueTierId: a.league_tier_id }, battles ?? [], now));
        checked.push(a.player_tag);
      } catch (err) {
        console.error(`Battle log read failed for ${a.player_tag} (non-fatal):`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  let stored = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data: inserted, error: insErr } = await supabase
      .from('ranked_attacks')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'player_tag,battle_at,opponent_tag', ignoreDuplicates: true })
      .select('player_tag');
    if (insErr) throw insErr;
    stored += (inserted as unknown[] | null)?.length ?? 0;
  }
  // Stamped only after the rows landed: a failed write leaves the accounts due, and they are re-read.
  if (checked.length) {
    const { error: stampErr } = await supabase
      .from('player_accounts')
      .update({ battle_log_checked_at: now.toISOString() })
      .in('player_tag', checked);
    if (stampErr) throw stampErr;
  }
  return { checked: checked.length, stored, remaining: due.length - checked.length };
}
