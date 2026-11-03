/**
 * Zustand store for the per-clan CWL war planner (/dashboard/cwl/[clanId]).
 *
 * Holds SERVER TRUTH for one clan in one season — its roster, rounds, war members, per-war overrides,
 * the standing CWL flags and the league group's other clans — plus the in-flight flags for the two
 * mutations. The plan itself is NOT stored: it is a pure function of these rows
 * (plannerInput.ts → planner.ts), so components derive it and it can never drift from its inputs.
 *
 * Mutations splice the one row the API returns, matching the other dashboard stores.
 */
import { create } from 'zustand';
import type { CWLSeason } from '@/types/database';
import type { RosterAccount, SourceGroupClan } from '@/lib/cwl/plannerInput';
import type { FlagRow, OverrideRow, PlannerData, PlannerMember, PlannerRound } from '@/lib/cwl/plannerLoad';

import type { LineupPostPreview } from '@/lib/cwl/nextLineupPostNotify';

export type { FlagRow, OverrideRow, PlannerMember, PlannerRound };

type ToastType = 'success' | 'error';
export type PlannerToast = { message: string; type: ToastType } | null;

/** One account on this clan's planner, with the person behind it (if any) for display. */
export type PlannerRosterAccount = RosterAccount;

interface PlannerState {
  seasons: CWLSeason[];
  seasonId: string | null;
  clanId: string | null;
  warSize: number;
  roster: PlannerRosterAccount[];
  rounds: PlannerRound[];
  members: PlannerMember[];
  overrides: OverrideRow[];
  flags: FlagRow[];
  optedOut: Set<string>;
  groupClans: SourceGroupClan[];

  loading: boolean;
  savingOverrideKey: string | null; // `${round}:${tag}`
  savingFlagTag: string | null;
  toast: PlannerToast;
  lineupPreview: LineupPostPreview | null;
  loadingLineupPreview: boolean;
  postingLineup: boolean;

  setToast: (t: PlannerToast) => void;
  loadSeasons: () => Promise<void>;
  load: (seasonId: string, clanId: string) => Promise<void>;
  setOverride: (roundNumber: number, playerTag: string, mode: 'in' | 'out' | null) => Promise<void>;
  setFlag: (playerTag: string, flag: 'banned' | 'rule_breaker', on: boolean) => Promise<void>;
  loadLineupPreview: (ping: boolean) => Promise<void>;
  clearLineupPreview: () => void;
  /** Resolves true when Discord accepted the post. */
  postLineup: (ping: boolean) => Promise<boolean>;
}

async function getJson(url: string) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function send(url: string, method: 'POST' | 'DELETE', body: unknown) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const useCwlPlannerStore = create<PlannerState>((set, get) => ({
  seasons: [],
  seasonId: null,
  clanId: null,
  warSize: 15,
  roster: [],
  rounds: [],
  members: [],
  overrides: [],
  flags: [],
  optedOut: new Set(),
  groupClans: [],
  loading: true,
  savingOverrideKey: null,
  savingFlagTag: null,
  toast: null,
  lineupPreview: null,
  loadingLineupPreview: false,
  postingLineup: false,

  setToast: (toast) => set({ toast }),

  loadSeasons: async () => {
    const res = await fetch('/api/views/cwl/seasons').catch(() => null);
    const data = res?.ok ? await res.json() : [];
    set({ seasons: Array.isArray(data) ? (data as CWLSeason[]) : [] });
  },

  load: async (seasonId, clanId) => {
    set({ loading: true, seasonId, clanId });
    try {
      const params = new URLSearchParams({ season: seasonId, clan: clanId });
      const data = (await getJson(`/api/views/cwl/planner?${params}`)) as Omit<PlannerData, 'optedOut'> & { optedOut: string[] };
      set({ ...data, optedOut: new Set(data.optedOut), loading: false });
    } catch (err) {
      console.error('CWL planner load error:', err);
      set({ loading: false, toast: { message: 'Failed to load the planner', type: 'error' } });
    }
  },

  setOverride: async (roundNumber, playerTag, mode) => {
    const { seasonId, clanId } = get();
    if (!seasonId || !clanId) return;
    set({ savingOverrideKey: `${roundNumber}:${playerTag}` });
    try {
      if (mode === null) {
        await send('/api/cwl/overrides', 'DELETE', { seasonId, roundNumber, playerTag });
      } else {
        await send('/api/cwl/overrides', 'POST', { seasonId, clanId, roundNumber, playerTag, mode });
      }
      set((s) => {
        const rest = s.overrides.filter((o) => !(o.round_number === roundNumber && o.player_account_tag === playerTag));
        return {
          overrides: mode === null ? rest : [...rest, { round_number: roundNumber, player_account_tag: playerTag, mode, reason: null }],
        };
      });
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Could not save the override', type: 'error' } });
    } finally {
      set({ savingOverrideKey: null });
    }
  },

  setFlag: async (playerTag, flag, on) => {
    set({ savingFlagTag: playerTag });
    try {
      await send('/api/cwl/flags', on ? 'POST' : 'DELETE', { playerTag, flag });
      set((s) => {
        const rest = s.flags.filter((f) => !(f.player_account_tag === playerTag && f.flag === flag));
        return { flags: on ? [...rest, { player_account_tag: playerTag, flag, reason: null }] : rest };
      });
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Could not save the flag', type: 'error' } });
    } finally {
      set({ savingFlagTag: null });
    }
  },

  loadLineupPreview: async (ping) => {
    const { seasonId, clanId } = get();
    if (!seasonId || !clanId) return;
    set({ loadingLineupPreview: true });
    try {
      const { preview } = await getJson(`/api/cwl/seasons/${seasonId}/post-lineup?clanId=${clanId}&ping=${ping ? 1 : 0}`);
      set({ lineupPreview: preview });
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Could not build the lineup post', type: 'error' } });
    } finally {
      set({ loadingLineupPreview: false });
    }
  },

  clearLineupPreview: () => set({ lineupPreview: null }),

  postLineup: async (ping) => {
    const { seasonId, clanId } = get();
    if (!seasonId || !clanId) return false;
    set({ postingLineup: true });
    try {
      const { roundNumber, updated } = await send(`/api/cwl/seasons/${seasonId}/post-lineup`, 'POST', { clanId, ping });
      set({ toast: { message: `War ${roundNumber} lineup ${updated ? 'updated' : 'posted'} on Discord`, type: 'success' } });
      return true;
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Posting failed', type: 'error' } });
      return false;
    } finally {
      set({ postingLineup: false });
    }
  },
}));
