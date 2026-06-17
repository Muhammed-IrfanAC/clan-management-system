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
