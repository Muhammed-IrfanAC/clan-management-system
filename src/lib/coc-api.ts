/**
 * CoC API Client Utility
 * Handles communication with the Clash of Clans API via VPS proxy.
 */

const COC_API_BASE = process.env.COC_API_PROXY_URL || 'https://api.clashofclans.com/v1';
const COC_API_TOKEN = process.env.COC_API_TOKEN;

export async function fetchFromCoC<T>(endpoint: string): Promise<T> {
  const url = `${COC_API_BASE}${endpoint}`;
  console.log(`[CoC API] Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${COC_API_TOKEN}`,
      'Accept': 'application/json',
    },
    next: { revalidate: 300 }
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
    next: { revalidate: 300 }
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
    id: number;
    name: string;
    iconUrls: { small: string; tiny: string; medium: string };
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
