import {
  fetchLeagueGroup,
  fetchLeagueWar,
  UNREVEALED_WAR_TAG,
  CoCLeagueGroup,
  CoCLeagueWar,
} from '../coc-api';

/**
 * Normalized snapshot of a clan's live CWL state.
 *  - group: the season container (participating clans, per-round war tags)
 *  - wars:  the fully-resolved wars whose tags have been revealed so far
 */
export interface LeagueStateSnapshot {
  group: CoCLeagueGroup;
  wars: CoCLeagueWar[];
}

/**
 * Poll a clan's current CWL state, isolating all of the seasonal/encoding quirks in one
 * place so downstream consumers (round tracking, performance history) stay clean:
 *  - Returns null off-season — fetchLeagueGroup 404s when no CWL is running.
 *  - Skips the '#0' placeholder tag used for rounds not yet matched.
 *  - Fetches each revealed war tag (fetchLeagueWar handles '#' URL-encoding).
 *
 * NOT yet wired into sync — added alongside its first consumer in a later phase. This is
 * the foundation the Phase 2/3 ingestion will call.
 */
export async function pollLeagueState(clanTag: string): Promise<LeagueStateSnapshot | null> {
  const group = await fetchLeagueGroup(clanTag);
  if (!group) return null;

  const warTags = group.rounds
    .flatMap((round) => round.warTags)
    .filter((tag) => tag && tag !== UNREVEALED_WAR_TAG);

  const wars = await Promise.all(warTags.map((tag) => fetchLeagueWar(tag)));

  return { group, wars };
}
