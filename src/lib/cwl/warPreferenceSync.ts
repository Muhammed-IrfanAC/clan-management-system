import { supabase } from '@/lib/supabase';
import { fetchFromCoCOptional, type CoCPlayer } from '@/lib/coc-api';

/**
 * Refresh the in-game war preference ("in" | "out", migration 047) of every account signed into a
 * CWL season that is still running — a step of the full sync, after the CWL poll has stored each
 * clan's signup list (`cwl_group_clans.is_own`).
 *
 * The preference is only on the per-player profile, one CoC call per account, so the refresh is
 * bounded three ways: only CWL signups (nothing outside CWL week), only accounts not checked in the
 * last REFRESH_AFTER_MS (oldest first), and only while the sync's deadline allows. Whatever is left
 * is picked up by the next sync. Accounts we have no row for (signed up, then left the clan before
 * we ever synced them) are skipped — there is nowhere to store it, and they are gone anyway.
 *
 * Writes touch only the two preference columns, in one grouped UPDATE per value — never an upsert,
 * which could write the rest of the row.
 */
const REFRESH_AFTER_MS = 10 * 60_000;
const CONCURRENCY = 5;

export async function refreshWarPreferences(opts: { deadline: number }): Promise<{ checked: number; out: number; remaining: number }> {
  const { data: seasons, error: seasonErr } = await supabase.from('cwl_seasons').select('id').neq('status', 'completed');
  if (seasonErr) throw seasonErr;
  const seasonIds = (seasons || []).map((s) => s.id as string);
  if (seasonIds.length === 0) return { checked: 0, out: 0, remaining: 0 };

  const { data: signups, error: signupErr } = await supabase
    .from('cwl_group_clans')
    .select('members')
    .in('season_id', seasonIds)
    .eq('is_own', true);
  if (signupErr) throw signupErr;
  const tags = [
    ...new Set(((signups as { members: { tag: string }[] }[]) || []).flatMap((s) => s.members.map((m) => m.tag))),
  ];
  if (tags.length === 0) return { checked: 0, out: 0, remaining: 0 };

  const { data: accounts, error: accErr } = await supabase
    .from('player_accounts')
    .select('player_tag, war_preference_checked_at')
    .in('player_tag', tags);
  if (accErr) throw accErr;

  const staleBefore = Date.now() - REFRESH_AFTER_MS;
  const due = ((accounts as { player_tag: string; war_preference_checked_at: string | null }[]) || [])
    .filter((a) => !a.war_preference_checked_at || new Date(a.war_preference_checked_at).getTime() < staleBefore)
    .sort((a, b) => (a.war_preference_checked_at ?? '').localeCompare(b.war_preference_checked_at ?? ''))
    .map((a) => a.player_tag);

  const results = new Map<string, 'in' | 'out'>();
  let next = 0;
  const worker = async () => {
    while (next < due.length && Date.now() < opts.deadline) {
      const tag = due[next++];
      try {
        const player = await fetchFromCoCOptional<CoCPlayer>(`/players/${encodeURIComponent(tag)}`);
        if (player?.warPreference === 'in' || player?.warPreference === 'out') results.set(tag, player.warPreference);
      } catch (err) {
        console.error(`War preference read failed for ${tag} (non-fatal):`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const checkedAt = new Date().toISOString();
  for (const pref of ['in', 'out'] as const) {
    const group = [...results].filter(([, p]) => p === pref).map(([tag]) => tag);
    if (group.length === 0) continue;
    const { error } = await supabase
      .from('player_accounts')
      .update({ war_preference: pref, war_preference_checked_at: checkedAt })
      .in('player_tag', group);
    if (error) throw error;
  }

  return {
    checked: results.size,
    out: [...results.values()].filter((p) => p === 'out').length,
    remaining: due.length - results.size,
  };
}
