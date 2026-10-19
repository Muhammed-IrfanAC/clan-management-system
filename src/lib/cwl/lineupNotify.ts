import { supabase } from '@/lib/supabase';
import { diffLineup, type PlannedSlot, type ActualSlot, type LineupDiff } from './lineup';
import { diffFieldedLineups, type FieldedSlot } from './lineupChange';
import { discordIdsForAccountTags, sendDiscordMessage, webhookUrlForClan } from '@/lib/discord';
import { renderLineupSwap, renderRoundLineup } from './lineupPost';

/**
 * The DB/notify half of the planned-vs-actual lineup check — `lineup.ts` is the pure diff.
 *
 * Fires once per CWL round, at reveal: the war exists, the in-game roster is locked in, and battle
 * day has not started, which is the only window where a swap is still worth telling anyone about.
 * Called from live.ts immediately after a round's members are upserted, so it always reads the
 * lineup that poll just wrote.
 *
 * Gated three ways, all cheap and all necessary:
 *   - state must be 'preparation'  — a war already in battle or ended is news to nobody
 *   - lineup_notified_at must be null — sync runs on every dashboard load; without the stamp this
 *     would repost for the whole prep window
 *   - the stamp is written ONLY on a successful send, so a Discord outage retries next sync
 *
 * Best-effort throughout, matching the rest of the notification layer: every failure path is logged
 * and swallowed, because a notification must never be able to fail a roster sync.
 */

type AllocationRow = {
  player_account_tag: string;
  is_bench: boolean;
  person_id: string | null;
  account: { in_game_name: string | null } | null;
};

type MemberRow = { player_tag: string; name: string | null; map_position: number | null };

/**
 * The most recent EARLIER round this clan actually fielded, if any. Walks backwards rather than
 * taking round N-1 blindly: a round can exist with no member rows yet (revealed but not polled), and
 * comparing against an empty lineup would report the entire war as rotated in.
 */
async function previousRoundLineup(
  seasonId: string,
  clanId: string,
  roundNumber: number,
): Promise<FieldedSlot[] | null> {
  const { data: earlier } = await supabase
    .from('cwl_rounds')
    .select('id, round_number')
    .eq('season_id', seasonId)
    .eq('clan_id', clanId)
    .lt('round_number', roundNumber)
    .order('round_number', { ascending: false });

  for (const r of (earlier as { id: string; round_number: number }[] | null) || []) {
    const { data: members } = await supabase
      .from('cwl_war_members')
      .select('player_tag, name')
      .eq('round_id', r.id);
    const rows = (members as { player_tag: string; name: string | null }[] | null) || [];
    if (rows.length) return rows.map((m) => ({ playerTag: m.player_tag, name: m.name || m.player_tag }));
  }
  return null;
}

/**
 * Shape a rotation diff into the same LineupDiff the notice already renders. The swap-in `reason` is
 * always 'unplanned' here: "from the bench" is a statement about the PLAN, and this comparison is
 * not against the plan — a player rotating back in after a rest was never benched by anyone.
 */
function diffAgainstPreviousRound(previous: FieldedSlot[], actual: ActualSlot[]): LineupDiff {
  const change = diffFieldedLineups(previous, actual.map((a) => ({ playerTag: a.playerTag, name: a.name })));
  return {
    swappedIn: change.swappedIn.map((s) => ({ ...s, reason: 'unplanned' as const })),
    swappedOut: change.swappedOut,
    asPlanned: actual.length - change.swappedIn.length, // carried over from the last round
    plannedSize: previous.length,
    actualSize: actual.length,
    matchesPlan: !change.changed,
  };
}

export async function notifyLineupIfRevealed(params: {
  seasonId: string;
  clanId: string;
  roundId: string;
  roundNumber: number;
  state: string;
  opponentName: string | null;
  startTime: string | null;
}): Promise<void> {
  const { seasonId, clanId, roundId, roundNumber, state, opponentName, startTime } = params;
  if (state !== 'preparation') return;

  try {
    const { data: round } = await supabase
      .from('cwl_rounds')
      .select('lineup_notified_at')
      .eq('id', roundId)
      .maybeSingle();
    if (round?.lineup_notified_at) return; // already announced

    // The PLAN: every account this season allocated to this clan, bench flag included.
    const { data: allocs } = await supabase
      .from('cwl_allocations')
      .select('player_account_tag, is_bench, person_id, account:player_accounts(in_game_name)')
      .eq('season_id', seasonId)
      .eq('recommended_clan_id', clanId);

    const planned: PlannedSlot[] = ((allocs as unknown as AllocationRow[]) || []).map((a) => ({
      playerTag: a.player_account_tag,
      name: a.account?.in_game_name || a.player_account_tag,
      isBench: !!a.is_bench,
    }));

    // The REALITY: what the in-game roster fielded, read back by this same poll. Map-position order
    // so the message reads like the war map.
    const { data: members } = await supabase
      .from('cwl_war_members')
      .select('player_tag, name, map_position')
      .eq('round_id', roundId);

    const actual: ActualSlot[] = ((members as MemberRow[]) || [])
      .slice()
      .sort((a, b) => (a.map_position ?? 99) - (b.map_position ?? 99))
      .map((m) => ({ playerTag: m.player_tag, name: m.name || m.player_tag, mapPosition: m.map_position }));

    // Nothing to compare against — the lineup has not landed yet. Leave the round unstamped so the
    // next poll, once the roster is populated, still gets its notice.
    if (actual.length === 0) return;

    // WHAT to compare against. The plan is the right answer exactly once — for a clan's first
    // revealed round, when the formed roster still describes a single lineup. After that it does
    // not: signupReconcile.ts derives `is_bench` from "has appeared in any revealed lineup", which
    // is cumulative, so by round 3 nearly the whole signed-up roster is flagged a starter. Diffing a
    // 15-man war against 40 starters reported the entire rotating bench as "swapped out" every
    // round, while a returning player — already a starter by that rule — never showed up as swapped
    // in. That is the lopsided in/out count on Discord: not a detection bug, a comparison that had
    // outlived its input.
    //
    // From the second revealed round the honest comparison is lineup-vs-lineup against the previous
    // round, which is symmetric by construction (a CWL war is the same size every round, so a body
    // in means a body out) and answers the question a leader actually has: who changed since last
    // time. It is the same argument lineupChange.ts makes for mid-preparation swaps.
    const prev = await previousRoundLineup(seasonId, clanId, roundNumber);
    const diff = prev ? diffAgainstPreviousRound(prev, actual) : diffLineup(planned, actual);

    // Discord ids for the swapped-IN accounts only. Resolved account -> person -> discord_user_id in
    // one round trip; a null anywhere in that chain just means "name them, don't ping them".
    const swappedInMentions = await discordIdsForAccountTags(diff.swappedIn.map((s) => s.playerTag));

    const { data: clan } = await supabase
      .from('clans')
      .select('display_name')
      .eq('id', clanId)
      .maybeSingle();

    const sent = await sendDiscordMessage(renderRoundLineup({
      clanName: clan?.display_name || 'Clan',
      roundNumber,
      opponentName,
      startTime,
      diff,
      basis: prev ? 'previous_round' : 'plan',
      swappedInMentions,
    }), await webhookUrlForClan(clanId));

    if (sent) {
      await supabase
        .from('cwl_rounds')
        .update({ lineup_notified_at: new Date().toISOString() })
        .eq('id', roundId);
    }
  } catch (err) {
    console.error(`CWL lineup notice failed for round ${roundId} (non-fatal):`, err);
  }
}

/** One appended entry of cwl_rounds.lineup_changes (migration 030). */
interface LineupChangeEvent {
  at: string;
  swappedIn: FieldedSlot[];
  swappedOut: FieldedSlot[];
}

/**
 * Record — and announce — a lineup swap made AFTER the round was revealed.
 *
 * `notifyLineupIfRevealed` above fires once and stamps the round, which is right for the reveal and
 * leaves a mid-preparation swap silent. This is the other half: called from live.ts with the lineup
 * as it stood before this poll and as it stands after, so the comparison is lineup-vs-lineup rather
 * than lineup-vs-plan (the plan is rewritten from the in-game signup list every sync and would show
 * "as planned" one poll later — see lineupChange.ts).
 *
 * Preparation only. The CWL war roster locks when battle day starts, so a membership difference in
 * any later state is not a leader's swap and there is nothing anyone could act on.
 *
 * The event is appended to the round WHETHER OR NOT Discord accepts the message: the swap is an
 * observed fact and the round card is its durable record, while the notice is best-effort like the
 * rest of the notify layer. Idempotency needs no stamp — the next poll compares against a lineup
 * that now includes this change, so an unchanged lineup produces nothing.
 */
export async function recordLineupChange(params: {
  clanId: string;
  roundId: string;
  roundNumber: number;
  state: string;
  opponentName: string | null;
  startTime: string | null;
  previous: FieldedSlot[];
  current: FieldedSlot[];
}): Promise<void> {
  const { clanId, roundId, roundNumber, state, opponentName, startTime, previous, current } = params;
  if (state !== 'preparation') return;
  // Nothing recorded yet means this poll IS the reveal, which notifyLineupIfRevealed announces.
  if (previous.length === 0) return;

  try {
    const change = diffFieldedLineups(previous, current);
    if (!change.changed) return;

    const { data: round } = await supabase
      .from('cwl_rounds')
      .select('lineup_changes')
      .eq('id', roundId)
      .maybeSingle();

    const at = new Date().toISOString();
    const history = ((round?.lineup_changes as LineupChangeEvent[] | null) || []).concat({
      at,
      swappedIn: change.swappedIn,
      swappedOut: change.swappedOut,
    });

    await supabase
      .from('cwl_rounds')
      .update({ lineup_changes: history, lineup_changed_at: at })
      .eq('id', roundId);

    const [swappedInMentions, { data: clan }] = await Promise.all([
      discordIdsForAccountTags(change.swappedIn.map((s) => s.playerTag)),
      supabase.from('clans').select('display_name').eq('id', clanId).maybeSingle(),
    ]);

    const message = renderLineupSwap({
      clanName: clan?.display_name || 'Clan',
      roundNumber,
      opponentName,
      startTime,
      swappedIn: change.swappedIn,
      swappedOut: change.swappedOut,
      swappedInMentions,
    });
    if (message) await sendDiscordMessage(message, await webhookUrlForClan(clanId));
  } catch (err) {
    console.error(`CWL lineup change record failed for round ${roundId} (non-fatal):`, err);
  }
}
