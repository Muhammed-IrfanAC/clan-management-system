import type { CWLAllocationStatus, CWLTransferStatus, CWLLeague } from '@/types/database';

// A player as shown on the roster board: their allocation joined with the account's live stats.
export interface RosterPlayer {
  allocationId: string;
  personId: string;
  name: string;
  thLevel: number;
  league: CWLLeague | null;
  recommendedClanId: string | null;
  actualClanId: string | null;
  status: CWLAllocationStatus;
  isBench: boolean;
}

// A required in-game move, resolved to display names for the transfers panel.
export interface TransferItem {
  id: string;
  personName: string;
  fromClanName: string;
  toClanName: string;
  status: CWLTransferStatus;
}

export type MoveAction = 'assign' | 'bench' | 'unbench' | 'remove';
