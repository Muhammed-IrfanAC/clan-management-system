import { supabase } from '@/lib/supabase';
import { fetchLeagueHistory } from '@/lib/coc-api';
import { lastEndedWeek, POST_DELAY_MS, RANKED_WEEK_SECONDS } from '@/lib/warStats/rankedWeek';
import { cwlSignupTags, recentWarCounts } from '@/lib/cwl/familyStrengthLoad';
import { leagueWeekRows, type LeagueWeekRow } from './leagueWeeks';

/**
 * Keep each account's finished Ranked weeks (`ranked_league_weeks`, migration 050) — a step of the full
 * sync. The league history API serves only ~5 weeks, so what is not stored is lost; the first read of
 * an account backfills all of them.
 *
 * Read: every active account, every account that played a war with us in the last 30 days (members
 * visiting other clans stay on the Strength leaderboard) and every signup of a running CWL. Each is re-read once per finished week —
 * when its last read predates that week's results (the reset plus POST_DELAY_MS) — oldest first, and
 * only while the sync's deadline allows. Each week's TH comes from the account's war rows
 * (`leagueWeeks.ts`). Rows are inserted ON CONFLICT DO NOTHING; the check is stamped only after they land.
 */
const CONCURRENCY = 5;
/** War rows read back for the weeks' THs: the history's ~5 weeks, plus margin. */
const TH_LOOKBACK_DAYS = 49;
const PAGE = 1000;

type AccountRow = { player_tag: string; th_level: number | null; league_history_checked_at: string | null };

export async function syncLeagueWeeks(opts: { deadline: number; now?: Date }): Promise<{ checked: number; stored: number; remaining: number }> {
  const now = opts.now ?? new Date();
  const published = lastEndedWeek(now).end.getTime() + POST_DELAY_MS;
  // Before this week's results are out, the bar is last week's.
  const dueBefore = now.getTime() >= published ? published : published - RANKED_WEEK_SECONDS * 1000;

  // Everyone the Strength ranking can hold: active, warring with us lately, or signed up for a running CWL.
  const [warCounts, signups] = await Promise.all([recentWarCounts(), cwlSignupTags()]);
  const recent = [...new Set([...warCounts.keys(), ...signups])];
  const [activeRes, recentRes] = await Promise.all([
    supabase.from('player_accounts').select('player_tag, th_level, league_history_checked_at').eq('status', 'active'),
    recent.length
      ? supabase.from('player_accounts').select('player_tag, th_level, league_history_checked_at').in('player_tag', recent).neq('status', 'active')
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (activeRes.error) throw activeRes.error;
  if (recentRes.error) throw recentRes.error;
  const due = [...((activeRes.data as AccountRow[]) || []), ...((recentRes.data as AccountRow[]) || [])]
    .filter((a) => !a.league_history_checked_at || new Date(a.league_history_checked_at).getTime() < dueBefore)
    .sort((a, b) => (a.league_history_checked_at ?? '').localeCompare(b.league_history_checked_at ?? ''));
  if (due.length === 0) return { checked: 0, stored: 0, remaining: 0 };

  const wars = await warThs(due.map((a) => a.player_tag), now);
  const checked: string[] = [];
  const rows: LeagueWeekRow[] = [];
  let next = 0;
  const worker = async () => {
    while (next < due.length && Date.now() < opts.deadline) {
      const a = due[next++];
      try {
        const history = await fetchLeagueHistory(a.player_tag);
        rows.push(...leagueWeekRows({ playerTag: a.player_tag, thLevel: a.th_level }, history ?? [], wars.get(a.player_tag) ?? []));
        checked.push(a.player_tag);
      } catch (err) {
        console.error(`League history read failed for ${a.player_tag} (non-fatal):`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  let stored = 0;
  if (rows.length) {
    const { data, error } = await supabase
      .from('ranked_league_weeks')
      .upsert(rows, { onConflict: 'player_tag,league_season_id', ignoreDuplicates: true })
      .select('player_tag');
    if (error) throw error;
    stored = (data as unknown[] | null)?.length ?? 0;
  }
  if (checked.length) {
    const { error } = await supabase.from('player_accounts').update({ league_history_checked_at: now.toISOString() }).in('player_tag', checked);
    if (error) throw error;
  }
  return { checked: checked.length, stored, remaining: due.length - checked.length };
}

/** The TH of each war these accounts played in the lookback, regular and CWL. */
async function warThs(tags: string[], now: Date): Promise<Map<string, { at: number; th: number }[]>> {
  const since = new Date(now.getTime() - TH_LOOKBACK_DAYS * 86_400_000).toISOString();
  type Row = { player_tag: string; th_level: number | null; round: { start_time: string | null } | null };
  const read = async (table: 'war_members' | 'cwl_war_members', rounds: 'war_rounds' | 'cwl_rounds') => {
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select(`player_tag, th_level, round:${rounds}!inner(start_time)`)
        .in('player_tag', tags)
        .gte('round.start_time', since)
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const page = (data as unknown as Row[]) || [];
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  };
  const [regular, cwl] = await Promise.all([read('war_members', 'war_rounds'), read('cwl_war_members', 'cwl_rounds')]);
  const byTag = new Map<string, { at: number; th: number }[]>();
  for (const r of [...regular, ...cwl]) {
    const at = r.round?.start_time ? Date.parse(r.round.start_time) : NaN;
    if (!r.th_level || Number.isNaN(at)) continue;
    byTag.set(r.player_tag, [...(byTag.get(r.player_tag) ?? []), { at, th: r.th_level }]);
  }
  return byTag;
}
