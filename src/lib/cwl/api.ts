import {
  fetchLeagueGroup,
  fetchLeagueWar,
  UNREVEALED_WAR_TAG,
  CoCLeagueGroup,
  CoCLeagueWar,
} from '../coc-api';

/** A resolved league war tagged with the war tag it was fetched by (the API war body omits it). */
export type TaggedLeagueWar = CoCLeagueWar & { warTag: string };

/**
 * Normalized snapshot of a clan's live CWL state.
 *  - group:          the season container (participating clans, per-round war tags)
 *  - wars:           the fetched wars, each carrying its warTag so callers can map a group round's
 *                    tag back to its war. Only wars that may be ours are fetched (see pollLeagueState).
 *  - settledRounds:  1-based round numbers skipped because the caller already holds them as ended.
 */
export interface LeagueStateSnapshot {
  group: CoCLeagueGroup;
  wars: TaggedLeagueWar[];
  settledRounds: number[];
}

/** What the caller already knows about a round: the war tag it found ours in, and whether it ended. */
export interface KnownRound {
  warTag: string;
  ended: boolean;
}

/**
 * Poll a clan's current CWL state, isolating all of the seasonal/encoding quirks in one
 * place so downstream consumers (round tracking, performance history) stay clean:
 *  - Returns null off-season — fetchLeagueGroup 404s when no CWL is running.
 *  - Skips the '#0' placeholder tag used for rounds not yet matched.
 *  - Fetches only the wars that can be ours. A round holds four wars and one is ours, so fetching
 *    every revealed tag cost four calls per round per poll, re-fetching finished wars all week. A
 *    round in `known` whose tag is still listed needs only that war, or nothing once it has ended
 *    (an ended war cannot change); a round not yet known fetches its tags to find ours.
 *
 * `fetchWar` lets the caller share one fetch per war tag across the clans of a pass.
 */
export async function pollLeagueState(
  clanTag: string,
  opts: { known?: Map<number, KnownRound>; fetchWar?: (warTag: string) => Promise<CoCLeagueWar> } = {},
): Promise<LeagueStateSnapshot | null> {
  const group = await fetchLeagueGroup(clanTag);
  if (!group) return null;
  const fetchWar = opts.fetchWar ?? fetchLeagueWar;

  const settledRounds: number[] = [];
  const toFetch: string[] = [];
  group.rounds.forEach((round, i) => {
    const tags = round.warTags.filter((tag) => tag && tag !== UNREVEALED_WAR_TAG);
    const known = opts.known?.get(i + 1);
    if (known && tags.includes(known.warTag)) {
      if (known.ended) settledRounds.push(i + 1);
      else toFetch.push(known.warTag);
    } else {
      toFetch.push(...tags);
    }
  });

  const wars = await Promise.all(
    toFetch.map(async (tag) => ({ ...(await fetchWar(tag)), warTag: tag })),
  );

  return { group, wars, settledRounds };
}
