/**
 * Zustand store for the Clan War League screen.
 *
 * Why a store: /dashboard/cwl predated the store convention and was the last big page still on
 * "every action calls load() and re-fetches the entire season". Confirming one transfer re-read the
 * allocations, the transfers, every round and every war member, then re-rendered all of it — which
 * on a 3-clan family is four round-trips and a full-board flash to tick one checkbox.
 *
 * This store follows the same contract as strikeStore/activityStore: it holds SERVER TRUTH plus the
 * transient in-flight flags, and every mutation applies a GRANULAR, id-keyed splice of the row the
 * API returns, so only the affected card re-renders. The one deliberate exception is re-allocation,
 * which regenerates the whole roster by design and therefore does reload the season.
 *
 * UI-local state (open menus, form drafts, modal visibility, create-vs-view mode) stays in the
 * components.
 */

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type {
  CWLAllocationStatus,
  CWLConstraints,
  CWLRound,
  CWLSeason,
  CWLSeasonStatus,
  CWLWarMember,
} from '@/types/database';
import { normalizeLeagueTier } from '@/lib/cwl/leagues';
import type { SeasonPosts } from '@/lib/cwl/rosterPostNotify';
import type { RosterPlayer, TransferItem, SeasonClan, MoveAction } from '@/components/cwl/types';

type ToastType = 'success' | 'error';
export type CWLToast = { message: string; type: ToastType } | null;

// ── Row shapes as they come back from PostgREST ──────────────────────────────────────────────
type AllocationRow = {
  id: string;
  player_account_tag: string;
  person_id: string;
  recommended_clan_id: string | null;
  actual_clan_id: string | null;
  status: CWLAllocationStatus;
  is_bench: boolean;
  person: { display_name: string } | null;
  account: { in_game_name: string | null; th_level: number | null; league: string | null; league_tier_id: number | null } | null;
};
type SeasonClanRow = { clan_id: string; war_size: number; priority: number | null };
type TransferRow = {
  id: string;
  status: TransferItem['status'];
  from_clan_id: string | null;
  to_clan_id: string | null;
  allocation: {
    player_account_tag: string;
    person: { display_name: string } | null;
    account: { in_game_name: string | null } | null;
  } | null;
};

const TRANSFER_SELECT =
  'id, status, from_clan_id, to_clan_id, allocation:cwl_allocations!inner(season_id, player_account_tag, ' +
  'person:persons(display_name), account:player_accounts(in_game_name))';

const ALLOCATION_SELECT =
  'id, player_account_tag, person_id, recommended_clan_id, actual_clan_id, status, is_bench, ' +
  'person:persons(display_name), account:player_accounts(in_game_name, th_level, league, league_tier_id)';

/** Map a transfer row + its embeds into the panel's view model. */
function toTransferItem(row: TransferRow): TransferItem {
  return {
    id: row.id,
    playerName: row.allocation?.account?.in_game_name || row.allocation?.player_account_tag || 'Unknown',
    personName: row.allocation?.person?.display_name || '—',
    fromClanId: row.from_clan_id,
    toClanId: row.to_clan_id,
    status: row.status,
  };
}

/** Map an allocation row + its embeds into the board's view model. */
function toRosterPlayer(row: AllocationRow, altPersonIds: Set<string>): RosterPlayer {
  return {
    allocationId: row.id,
    playerTag: row.player_account_tag,
    personId: row.person_id,
    name: row.account?.in_game_name || row.person?.display_name || row.player_account_tag,
    personName: row.person?.display_name || '—',
    isAlt: altPersonIds.has(row.person_id),
    thLevel: row.account?.th_level ?? 0,
    leagueTier: normalizeLeagueTier(row.account?.league ?? null, row.account?.league_tier_id ?? null),
    recommendedClanId: row.recommended_clan_id,
    actualClanId: row.actual_clan_id,
    status: row.status,
    isBench: row.is_bench,
  };
}

type CWLState = {
  // Server truth
  seasons: CWLSeason[];
  selectedSeasonId: string | null;
  seasonClans: SeasonClan[]; // always kept sorted by priority
  players: RosterPlayer[];
  transfers: TransferItem[];
  rounds: CWLRound[];
  warMembers: CWLWarMember[];

  // Load / in-flight flags. Per-row guards so one card shows its own spinner, not the whole page.
  loadingSeasons: boolean;
  loadingSeason: boolean;
  movingAllocationId: string | null;
  savingTransferId: string | null;
  savingSeason: boolean; // status change / delete / re-allocate — whole-season scoped actions
  savingPriority: boolean;
  toast: CWLToast;

  // Discord roster publishing. The preview is the exact set of messages the API would send, so what
  // a leader approves is what the family receives.
  rosterPost: SeasonPosts | null;
  loadingRosterPost: boolean;
  postingRoster: 'roster' | 'transfers' | null;

  setToast: (toast: CWLToast) => void;
  selectSeason: (id: string) => void;
  loadSeasons: (selectAfter?: string) => Promise<void>;
  loadSeason: (seasonId: string) => Promise<void>;
  createSeason: (input: {
    label: string;
    clans: { clanId: string; warSize: number; priority: number }[];
    constraints: CWLConstraints;
  }) => Promise<string | null>;
  moveAllocation: (allocationId: string, action: MoveAction, clanId?: string) => Promise<void>;
  toggleTransfer: (transferId: string, done: boolean) => Promise<void>;
  setSeasonStatus: (status: CWLSeasonStatus) => Promise<void>;
  reorderClans: (clanIds: string[]) => Promise<void>;
  setWarSize: (clanId: string, warSize: number) => Promise<void>;
  reallocate: () => Promise<void>;
  deleteSeason: () => Promise<boolean>;
  loadRosterPost: () => Promise<void>;
  clearRosterPost: () => void;
  publishRosterPost: (target: 'roster' | 'transfers') => Promise<void>;
};

/** POST/PATCH helper that surfaces the API's error message rather than a generic failure. */
async function send(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  const res = await fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const useCWLStore = create<CWLState>((set, get) => ({
  seasons: [],
  selectedSeasonId: null,
  seasonClans: [],
  players: [],
  transfers: [],
  rounds: [],
  warMembers: [],
  loadingSeasons: true,
  loadingSeason: false,
  movingAllocationId: null,
  savingTransferId: null,
  savingSeason: false,
  savingPriority: false,
  toast: null,
  rosterPost: null,
  loadingRosterPost: false,
  postingRoster: null,

  setToast: (toast) => set({ toast }),
  selectSeason: (id) => set({ selectedSeasonId: id }),

  loadSeasons: async (selectAfter) => {
    const { data } = await supabase.from('cwl_seasons').select('*').order('created_at', { ascending: false });
    const rows = (data as CWLSeason[]) || [];
    const prev = get().selectedSeasonId;
    set({
      seasons: rows,
      loadingSeasons: false,
      selectedSeasonId: selectAfter ?? (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null),
    });
  },

  loadSeason: async (seasonId) => {
    set({ loadingSeason: true });
    try {
      const [{ data: clanRows }, { data: allocRows }, { data: transferRows }, { data: roundRows }] = await Promise.all([
        supabase.from('cwl_season_clans').select('clan_id, war_size, priority').eq('season_id', seasonId),
        supabase.from('cwl_allocations').select(ALLOCATION_SELECT).eq('season_id', seasonId),
        supabase.from('cwl_transfers').select(TRANSFER_SELECT).eq('allocation.season_id', seasonId),
        supabase.from('cwl_rounds').select('*').eq('season_id', seasonId),
      ]);

      const allocations = (allocRows as unknown as AllocationRow[]) || [];

      // A person with more than one allocated account is flying alts; the board marks those rows so
      // "why is this name here twice" answers itself.
      const perPerson = new Map<string, number>();
      for (const a of allocations) perPerson.set(a.person_id, (perPerson.get(a.person_id) ?? 0) + 1);
      const altPersonIds = new Set(Array.from(perPerson).filter(([, n]) => n > 1).map(([id]) => id));

      // Live rounds + their lineups (populated by sync).
      const liveRounds = (roundRows as CWLRound[]) || [];
      let liveMembers: CWLWarMember[] = [];
      if (liveRounds.length) {
        const { data: memberRows } = await supabase
          .from('cwl_war_members')
          .select('*')
          .in('round_id', liveRounds.map((r) => r.id));
        liveMembers = (memberRows as CWLWarMember[]) || [];
      }

      set({
        seasonClans: ((clanRows as SeasonClanRow[]) || [])
          .map((r) => ({ clanId: r.clan_id, warSize: r.war_size, priority: r.priority ?? 0 }))
          .sort((a, b) => a.priority - b.priority),
        players: allocations.map((a) => toRosterPlayer(a, altPersonIds)),
        transfers: ((transferRows as unknown as TransferRow[]) || []).map(toTransferItem),
        rounds: liveRounds,
        warMembers: liveMembers,
        loadingSeason: false,
      });
    } catch (err) {
      console.error('CWL season load error:', err);
      set({ loadingSeason: false, toast: { message: 'Failed to load season data', type: 'error' } });
    }
  },

  createSeason: async (input) => {
    try {
      const data = await send('/api/cwl/seasons', 'POST', input);
      set({ toast: { message: 'CWL season created', type: 'success' } });
      await get().loadSeasons(data.seasonId);
      return data.seasonId as string;
    } catch (err: any) {
      set({ toast: { message: err.message || 'Failed to create season', type: 'error' } });
      return null;
    }
  },

  moveAllocation: async (allocationId, action, clanId) => {
    set({ movingAllocationId: allocationId });
    try {
      const { allocation } = await send('/api/cwl/allocations/move', 'POST', { allocationId, action, clanId });
      // Splice just this card. The engine's rank ordering is recomputed client-side by the board's
      // strength sort, so nothing else on screen is stale.
      set((s) => ({
        players: s.players.map((p) =>
          p.allocationId === allocationId
            ? {
                ...p,
                recommendedClanId: allocation.recommended_clan_id,
                actualClanId: allocation.actual_clan_id,
                status: allocation.status,
                isBench: allocation.is_bench,
              }
            : p,
        ),
      }));
      // A move creates, retargets or clears a pending transfer, and only the server knows which —
      // so the transfer list (small, one query) is the one thing re-read after a move.
      const seasonId = get().selectedSeasonId;
      if (seasonId) await refreshTransfers(seasonId, set);
    } catch (err: any) {
      set({ toast: { message: err.message || 'Move failed', type: 'error' } });
    } finally {
      set({ movingAllocationId: null });
    }
  },

  toggleTransfer: async (transferId, done) => {
    set({ savingTransferId: transferId });
    try {
      const { transfer, allocation } = await send('/api/cwl/transfers/confirm', 'POST', { transferId, done });
      set((s) => ({
        transfers: s.transfers.map((t) => (t.id === transferId ? { ...t, status: transfer.status } : t)),
        players: s.players.map((p) => (p.allocationId === allocation.id ? { ...p, status: allocation.status } : p)),
      }));
    } catch (err: any) {
      set({ toast: { message: err.message || 'Update failed', type: 'error' } });
    } finally {
      set({ savingTransferId: null });
    }
  },

  setSeasonStatus: async (status) => {
    const seasonId = get().selectedSeasonId;
    if (!seasonId) return;
    set({ savingSeason: true });
    try {
      await send(`/api/cwl/seasons/${seasonId}`, 'PATCH', { status });
      set((s) => ({
        seasons: s.seasons.map((x) => (x.id === seasonId ? { ...x, status } : x)),
        toast: { message: 'Season status updated', type: 'success' },
      }));
    } catch (err: any) {
      set({ toast: { message: err.message || 'Update failed', type: 'error' } });
    } finally {
      set({ savingSeason: false });
    }
  },

  reorderClans: async (clanIds) => {
    const seasonId = get().selectedSeasonId;
    if (!seasonId) return;
    const previous = get().seasonClans;
    // Optimistic: dragging a clan up should move instantly, and the payload is trivially reversible.
    const next = clanIds
      .map((clanId, priority) => {
        const existing = previous.find((c) => c.clanId === clanId);
        return existing ? { ...existing, priority } : null;
      })
      .filter((c): c is SeasonClan => c !== null);
    set({ seasonClans: next, savingPriority: true });
    try {
      await send(`/api/cwl/seasons/${seasonId}/clans`, 'PATCH', {
        clans: next.map((c) => ({ clanId: c.clanId, priority: c.priority })),
      });
    } catch (err: any) {
      set({ seasonClans: previous, toast: { message: err.message || 'Could not save the order', type: 'error' } });
    } finally {
      set({ savingPriority: false });
    }
  },

  setWarSize: async (clanId, warSize) => {
    const seasonId = get().selectedSeasonId;
    if (!seasonId) return;
    const previous = get().seasonClans;
    set({
      seasonClans: previous.map((c) => (c.clanId === clanId ? { ...c, warSize } : c)),
      savingPriority: true,
    });
    try {
      await send(`/api/cwl/seasons/${seasonId}/clans`, 'PATCH', {
        clans: [{ clanId, priority: previous.find((c) => c.clanId === clanId)?.priority ?? 0, warSize }],
      });
    } catch (err: any) {
      set({ seasonClans: previous, toast: { message: err.message || 'Could not save the war size', type: 'error' } });
    } finally {
      set({ savingPriority: false });
    }
  },

  reallocate: async () => {
    const seasonId = get().selectedSeasonId;
    if (!seasonId) return;
    set({ savingSeason: true });
    try {
      const { allocated } = await send(`/api/cwl/seasons/${seasonId}/reallocate`, 'POST');
      // The only full reload in the store, and deliberately so: this replaces every allocation and
      // transfer row in the season, so there is no granular splice to make.
      await get().loadSeason(seasonId);
      set({ toast: { message: `Roster regenerated — ${allocated} accounts allocated`, type: 'success' } });
    } catch (err: any) {
      set({ toast: { message: err.message || 'Re-allocation failed', type: 'error' } });
    } finally {
      set({ savingSeason: false });
    }
  },

  deleteSeason: async () => {
    const seasonId = get().selectedSeasonId;
    if (!seasonId) return false;
    set({ savingSeason: true });
    try {
      await send(`/api/cwl/seasons/${seasonId}`, 'DELETE');
      set((s) => ({
        seasons: s.seasons.filter((x) => x.id !== seasonId),
        selectedSeasonId: null,
        toast: { message: 'Season deleted', type: 'success' },
      }));
      await get().loadSeasons();
      return true;
    } catch (err: any) {
      set({ toast: { message: err.message || 'Delete failed', type: 'error' } });
      return false;
    } finally {
      set({ savingSeason: false });
    }
  },
  loadRosterPost: async () => {
    const seasonId = get().selectedSeasonId;
    if (!seasonId) return;
    set({ loadingRosterPost: true, rosterPost: null });
    try {
      const res = await fetch(`/api/cwl/seasons/${seasonId}/post-roster`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Preview failed');
      set({ rosterPost: data.posts as SeasonPosts });
    } catch (err: any) {
      set({ toast: { message: err.message || 'Could not build the preview', type: 'error' } });
    } finally {
      set({ loadingRosterPost: false });
    }
  },

  clearRosterPost: () => set({ rosterPost: null }),

  publishRosterPost: async (target) => {
    const seasonId = get().selectedSeasonId;
    if (!seasonId) return;
    set({ postingRoster: target });
    try {
      const { posted, failed } = await send(`/api/cwl/seasons/${seasonId}/post-roster`, 'POST', { target });
      // A partial success is reported as one: the leader needs to know WHICH channels missed out, not
      // just that "something" went wrong.
      set({
        toast: failed.length
          ? { message: `Posted ${posted} — failed: ${failed.join(', ')}`, type: 'error' }
          : {
              message: target === 'transfers' ? 'Transfer call sent' : `Roster posted to ${posted} channel${posted === 1 ? '' : 's'}`,
              type: 'success',
            },
      });
      // The stored message ids and the transfer-call stamp both moved — re-read so a second press
      // edits rather than re-posts.
      await get().loadRosterPost();
    } catch (err: any) {
      set({ toast: { message: err.message || 'Posting failed', type: 'error' } });
    } finally {
      set({ postingRoster: null });
    }
  },
}));

/** Re-read just the season's transfer list (used after a move retargets or clears one). */
async function refreshTransfers(seasonId: string, set: (partial: Partial<CWLState>) => void) {
  const { data } = await supabase.from('cwl_transfers').select(TRANSFER_SELECT).eq('allocation.season_id', seasonId);
  set({ transfers: ((data as unknown as TransferRow[]) || []).map(toTransferItem) });
}
