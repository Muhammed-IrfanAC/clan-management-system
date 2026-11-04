import { supabase } from '@/lib/supabase';
import { destinationForClan, discordIdsForAccountTags, postOrEditDiscordMessage, type DiscordMessage } from '@/lib/discord';
import { loadPlannerData } from './plannerLoad';
import { buildPlannerInput } from './plannerInput';
import { planSeason } from './planner';
import { renderLineupPost } from './nextLineupPost';
import { lineupSwaps } from './swaps';

/**
 * The DB/send half of the "next war lineup" Discord post (`nextLineupPost.ts` is the pure renderer).
 *
 * The plan is computed here from the same rows the planner page loads (plannerLoad.ts), so the post
 * is exactly the lineup the leader is looking at — overrides included.
 *
 * It is a LIVING message per clan per war (migration 046): posting war N again edits the message
 * already in the channel, while war N+1 gets a fresh one. An edit never re-notifies, so pinging is
 * only meaningful on the first post of a war; the preview says which one this would be.
 */
export interface LineupPostPreview {
  roundNumber: number | null; // null when every war has started
  message: DiscordMessage | null;
  /** True when this would EDIT the message already posted for this war. */
  updatesExisting: boolean;
}

async function build(seasonId: string, clanId: string, ping: boolean) {
  const [data, { data: season, error: seasonErr }, { data: clan, error: clanErr }, { data: sc, error: scErr }] = await Promise.all([
    loadPlannerData(seasonId, clanId),
    supabase.from('cwl_seasons').select('label').eq('id', seasonId).single(),
    supabase.from('clans').select('display_name').eq('id', clanId).single(),
    supabase
      .from('cwl_season_clans')
      .select('lineup_message_id, lineup_message_round')
      .eq('season_id', seasonId)
      .eq('clan_id', clanId)
      .single(),
  ]);
  if (seasonErr) throw seasonErr;
  if (clanErr) throw clanErr;
  if (scErr) throw scErr;

  const plan = planSeason(buildPlannerInput(data));
  const next = plan.rounds[0];
  const stored = sc as { lineup_message_id: string | null; lineup_message_round: number | null };
  if (!next) return { roundNumber: null, message: null, existingId: null };

  const mentionIds = await discordIdsForAccountTags(next.lineup.map((s) => s.playerTag));
  const opponent = data.rounds.find((r) => r.round_number === next.roundNumber)?.opponent_name ?? null;
  const message = renderLineupPost({
    clanName: (clan as { display_name: string }).display_name,
    seasonLabel: (season as { label: string }).label,
    roundNumber: next.roundNumber,
    opponentName: opponent,
    enemyKnown: next.enemyKnown,
    warSize: plan.warSize,
    lineup: next.lineup.map((s, i) => ({
      mapPosition: s.mapPosition,
      name: s.name,
      thLevel: s.thLevel,
      enemyTh: s.enemyTh,
      mentionId: mentionIds[i],
    })),
    bench: next.bench.map((b) => b.name),
    ping,
    swaps: (() => {
      const s = lineupSwaps({ planned: next.lineup, nextRoundNumber: next.roundNumber, rounds: data.rounds, members: data.members });
      return { fromRound: s.fromRound, fromCurrentPrep: s.fromCurrentPrep, out: s.out.map((x) => x.name), in: s.in.map((x) => x.name) };
    })(),
  });
  const existingId = stored.lineup_message_round === next.roundNumber ? stored.lineup_message_id : null;
  return { roundNumber: next.roundNumber, message, existingId };
}

/** The exact message POST would send. Sends nothing. */
export async function previewLineupPost(seasonId: string, clanId: string, ping: boolean): Promise<LineupPostPreview> {
  const { roundNumber, message, existingId } = await build(seasonId, clanId, ping);
  return { roundNumber, message, updatesExisting: !!existingId };
}

/** Post (or update) the clan's next-war lineup in its own channel. */
export async function postLineup(
  seasonId: string,
  clanId: string,
  ping: boolean,
): Promise<{ ok: boolean; roundNumber: number | null; updated: boolean }> {
  const { roundNumber, message, existingId } = await build(seasonId, clanId, ping);
  if (!message || roundNumber == null) return { ok: false, roundNumber: null, updated: false };

  const messageId = await postOrEditDiscordMessage(message, {
    destination: await destinationForClan(clanId),
    messageId: existingId,
  });
  if (!messageId) return { ok: false, roundNumber, updated: false };

  const { error } = await supabase
    .from('cwl_season_clans')
    .update({ lineup_message_id: messageId, lineup_message_round: roundNumber })
    .eq('season_id', seasonId)
    .eq('clan_id', clanId);
  if (error) throw error;
  return { ok: true, roundNumber, updated: messageId === existingId };
}
