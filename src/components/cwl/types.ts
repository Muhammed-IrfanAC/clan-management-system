import type { CWLAllocationStatus, CWLTransferStatus, CWLLeagueTierId } from '@/types/database';

// One ACCOUNT on the roster board: its allocation joined with the account's live stats. CWL signs up
// accounts, so a person's main and alts each appear as their own row; `personName` is what visually
// groups them back together (and links to the profile).
export interface RosterPlayer {
  allocationId: string;
  playerTag: string;
  personId: string;
  name: string; // the account's in-game name — what a leader reads on a war map
  personName: string; // the family display name behind the account
  isAlt: boolean; // this person has more than one account in the season pool
  thLevel: number;
  leagueTier: CWLLeagueTierId | null;
  recommendedClanId: string | null;
  actualClanId: string | null;
  status: CWLAllocationStatus;
  isBench: boolean;
}

// A required in-game move. Clan ids (not names) — the panel resolves them through ClanContext, the
// same source the rest of the page names clans from.
export interface TransferItem {
  id: string;
  playerName: string; // the account being moved
  personName: string;
  fromClanId: string | null;
  toClanId: string | null;
  status: CWLTransferStatus;
}

// One clan in the season pool, in fill-priority order (index 0 = filled first).
export interface SeasonClan {
  clanId: string;
  warSize: number;
  priority: number;
}

export type MoveAction = 'assign' | 'bench' | 'unbench' | 'remove';
