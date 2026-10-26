/**
 * CoC API Client Utility
 * Handles communication with the Clash of Clans API via VPS proxy.
 */

const COC_API_BASE = process.env.COC_API_PROXY_URL || 'https://api.clashofclans.com/v1';
const COC_API_TOKEN = process.env.COC_API_TOKEN;
// A hung proxy connection would otherwise hold the whole sync until the function is killed.
const COC_TIMEOUT_MS = 10_000;

export async function fetchFromCoC<T>(endpoint: string): Promise<T> {
  const url = `${COC_API_BASE}${endpoint}`;
  console.log(`[CoC API] Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${COC_API_TOKEN}`,
      'Accept': 'application/json',
    },
    // Live game state, never cached: a cached war read would delay every attack's first-seen
    // timestamp (late-snipe timing) by up to the cache lifetime.
    cache: 'no-store',
    signal: AbortSignal.timeout(COC_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[CoC API] Error ${response.status}: ${errorText}`);
    try {
      const error = JSON.parse(errorText);
      throw new Error(error.message || `CoC API error: ${response.status}`);
    } catch (e) {
      throw new Error(`CoC API error: ${response.status} - ${errorText}`);
    }
  }

  return response.json();
}

/**
 * Like fetchFromCoC, but treats a 404 as an expected "not found" rather than an error,
 * returning null instead of throwing. CWL data is seasonal: the league group endpoint
 * only exists during CWL week and 404s the rest of the month, which is a normal empty
 * state, not a failure. All other non-2xx statuses still throw.
 */
export async function fetchFromCoCOptional<T>(endpoint: string): Promise<T | null> {
  const url = `${COC_API_BASE}${endpoint}`;
  console.log(`[CoC API] Fetching (optional): ${url}`);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${COC_API_TOKEN}`,
      'Accept': 'application/json',
    },
    // Live game state, never cached: a cached war read would delay every attack's first-seen
    // timestamp (late-snipe timing) by up to the cache lifetime.
    cache: 'no-store',
    signal: AbortSignal.timeout(COC_TIMEOUT_MS),
  });

  if (response.status === 404) return null;

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[CoC API] Error ${response.status}: ${errorText}`);
    try {
      const error = JSON.parse(errorText);
      throw new Error(error.message || `CoC API error: ${response.status}`);
    } catch (e) {
      throw new Error(`CoC API error: ${response.status} - ${errorText}`);
    }
  }

  return response.json();
}

// The '#0' placeholder war tag marks a round that has not been matched/revealed yet;
// the API returns it for future rounds of an in-progress league group. Skip these.
export const UNREVEALED_WAR_TAG = '#0';

/**
 * Fetch a clan's current CWL league group. Returns null off-season (404) — see
 * fetchFromCoCOptional. The group lists the 7 (or 5) rounds, each a set of war tags.
 */
export async function fetchLeagueGroup(clanTag: string): Promise<CoCLeagueGroup | null> {
  return fetchFromCoCOptional<CoCLeagueGroup>(
    `/clans/${encodeURIComponent(clanTag)}/currentwar/leaguegroup`
  );
}

/**
 * Fetch a single CWL war by its war tag. War tags contain '#', so they must be
 * URL-encoded. Callers should skip UNREVEALED_WAR_TAG before calling this.
 */
export async function fetchLeagueWar(warTag: string): Promise<CoCLeagueWar> {
  return fetchFromCoC<CoCLeagueWar>(
    `/clanwarleagues/wars/${encodeURIComponent(warTag)}`
  );
}

/**
 * Fetch a clan's current REGULAR (non-CWL) war. Optional because a clan not currently in a war
 * returns state 'notInWar' (200) and a private war log 404s — both are normal empty states, not
 * failures. The queried clan is always returned as `war.clan` (the opponent as `war.opponent`).
 */
export async function fetchCurrentWar(clanTag: string): Promise<CoCCurrentWar | null> {
  return fetchFromCoCOptional<CoCCurrentWar>(
    `/clans/${encodeURIComponent(clanTag)}/currentwar`
  );
}

/**
 * A player's official per-week Ranked League results, one item per week they played (oldest first).
 * The current week is not in it until the week has ended; results appear a few minutes after the
 * Monday 05:00 UTC reset. 404s for an unknown tag, which reads as "no history".
 */
export async function fetchLeagueHistory(playerTag: string): Promise<CoCLeagueHistoryEntry[] | null> {
  const res = await fetchFromCoCOptional<{ items: CoCLeagueHistoryEntry[] }>(
    `/players/${encodeURIComponent(playerTag)}/leaguehistory`
  );
  return res ? res.items ?? [] : null;
}

/**
 * A player's most recent battles (about 50, newest last), ranked and multiplayer mixed. The only
 * source of per-attack stars for ranked battles, since the league history's `attackStars` is always 0.
 */
export async function fetchBattleLog(playerTag: string): Promise<CoCBattle[] | null> {
  const res = await fetchFromCoCOptional<{ items: CoCBattle[] }>(
    `/players/${encodeURIComponent(playerTag)}/battlelog`
  );
  return res ? res.items ?? [] : null;
}

export interface CoCLeagueHistoryEntry {
  /** The week's start as Unix seconds (a Monday, 05:00 UTC). */
  leagueSeasonId: number;
  leagueTrophies: number;
  leagueTierId: number;
  /** Final position in the player's league group. */
  placement: number;
  /** Ranked attacks made (a "win" is any attack that scored). */
  attackWins: number;
  attackLosses: number;
  /** Always 0 in practice; per-attack stars come from the battle log instead. */
  attackStars: number;
  defenseWins: number;
  defenseLosses: number;
  /** Stars conceded across all defences. */
  defenseStars: number;
  /** The tier's attack allowance for the week. */
  maxBattles: number;
}

export interface CoCBattle {
  battleType: string; // 'ranked' | 'homeVillage' | …
  attack: boolean;
  opponentPlayerTag: string;
  opponentName: string;
  opponentTownHallLevel: number;
  stars: number;
  destructionPercentage: number;
  battleTime: number;
  /** Compact CoC timestamp — see `cocTime.ts`. */
  battleTimestamp: string;
}

export interface CoCPlayer {
  tag: string;
  name: string;
  role: string;
  townHallLevel: number;
  expLevel: number;
  trophies: number;
  bestTrophies: number;
  donations: number;
  donationsReceived: number;
  clan?: {
    tag: string;
    name: string;
    clanLevel: number;
  };
}

export interface CoCClanMember {
  tag: string;
  name: string;
  role: string;
  townHallLevel: number;
  expLevel: number;
  league?: {
    // Legacy trophy league (Bronze…Titan…Legend). Kept for reference; NOT used for CWL eligibility.
    id: number;
    name: string;
    iconUrls: { small: string; tiny: string; medium: string };
  };
  leagueTier?: {
    // New Ranked-Battle tier (Oct 2025): 'Skeleton League 1' … 'Titan League 25' … 'Legend III'.
    id: number;
    name: string;
    iconUrls?: { small: string; large: string };
  };
  trophies: number;
  donations: number;
  donationsReceived: number;
}

export interface CoCClan {
  tag: string;
  name: string;
  type: string;
  description: string;
  location?: { id: number; name: string; isCountry: boolean; countryCode: string };
  badgeUrls: { small: string; large: string; medium: string };
  clanLevel: number;
  clanPoints: number;
  clanVersusPoints: number;
  requiredTrophies: number;
  warFrequency: string;
  warWinStreak: number;
  warWins: number;
  warTies: number;
  warLosses: number;
  isWarLogPublic: boolean;
  members: number;
  memberList: CoCClanMember[];
}

// ---- Clan War League (CWL) ----
// The league group is the season container for one clan: its status, participating
// clans, and the per-round list of war tags. It exists only during CWL week.

export interface CoCLeagueGroupClan {
  tag: string;
  name: string;
  clanLevel: number;
  badgeUrls: { small: string; large: string; medium: string };
  members: { tag: string; name: string; townHallLevel: number }[];
}

export interface CoCLeagueRound {
  warTags: string[]; // '#0' (UNREVEALED_WAR_TAG) for rounds not yet matched
}

export interface CoCLeagueGroup {
  state: string; // 'preparation' | 'inWar' | 'ended' | 'notInWar'
  season: string; // e.g. '2026-07'
  clans: CoCLeagueGroupClan[];
  rounds: CoCLeagueRound[];
}

// A single CWL war (one round for one pairing). Shape mirrors a regular clan war but
// each side is a CoCLeagueWarClan and members carry their per-war attacks.

export interface CoCLeagueWarAttack {
  attackerTag: string;
  defenderTag: string;
  stars: number;
  destructionPercentage: number;
  order: number;
}

export interface CoCLeagueWarMember {
  tag: string;
  name: string;
  townhallLevel: number;
  mapPosition: number;
  attacks?: CoCLeagueWarAttack[];
  opponentAttacks: number;
}

export interface CoCLeagueWarClan {
  tag: string;
  name: string;
  clanLevel: number;
  badgeUrls: { small: string; large: string; medium: string };
  attacks: number;
  stars: number;
  destructionPercentage: number;
  members: CoCLeagueWarMember[];
}

export interface CoCLeagueWar {
  state: string; // 'preparation' | 'inWar' | 'warEnded'
  teamSize: number; // 15 or 30
  preparationStartTime: string;
  startTime: string;
  endTime: string;
  clan: CoCLeagueWarClan;
  opponent: CoCLeagueWarClan;
  warStartTime?: string;
}

// ---- Regular Clan Wars ----
// Shape of /clans/{tag}/currentwar. Members carry up to `attacksPerMember` (usually 2) attacks;
// clan/opponent/members are absent when state is 'notInWar'.

export interface CoCWarAttack {
  attackerTag: string;
  defenderTag: string;
  stars: number;
  destructionPercentage: number;
  order: number;
  duration?: number;
}

export interface CoCWarMember {
  tag: string;
  name: string;
  townhallLevel: number;
  mapPosition: number;
  attacks?: CoCWarAttack[];
  opponentAttacks: number;
  bestOpponentAttack?: CoCWarAttack;
}

export interface CoCWarClan {
  tag: string;
  name: string;
  clanLevel: number;
  badgeUrls: { small: string; large: string; medium: string };
  attacks: number;
  stars: number;
  destructionPercentage: number;
  expEarned?: number;
  members: CoCWarMember[];
}

export interface CoCCurrentWar {
  state: string; // 'notInWar' | 'preparation' | 'inWar' | 'warEnded'
  teamSize?: number;
  attacksPerMember?: number;
  preparationStartTime?: string;
  startTime?: string;
  endTime?: string;
  clan?: CoCWarClan;
  opponent?: CoCWarClan;
}
