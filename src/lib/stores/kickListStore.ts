/**
 * Zustand store for the Kick List screen (`/dashboard/kicks`), and for the "Mark as kicked" action
 * the member dossier borrows.
 *
 * Server truth comes from `/api/kicks` (the list needs the watched alts and who is in a family clan
 * right now, which the route assembles). Mutations splice the returned entry in by tag, so only the
 * affected card re-renders.
 *
 * Actions return their outcome instead of raising a toast themselves: the dossier calls `addKick` too,
 * and a toast parked here would surface later on a page that never asked for it. Callers decide.
 */

import { create } from 'zustand';
import type { ToastState } from '@/components/ui/Toast';
import type { DepartureEntry, KickListEntry } from '@/lib/kicks/watch';

export type KickResult = { ok: true; entry: KickListEntry } | { ok: false; error: string };

type KickListState = {
  entries: KickListEntry[];
  departures: DepartureEntry[];
  loading: boolean;
  toast: ToastState | null;

  // Per-action in-flight guards.
  adding: boolean;
  savingTag: string | null;
  removingTag: string | null;

  setToast: (toast: ToastState | null) => void;
  fetchAll: () => Promise<void>;
  addKick: (playerTag: string, comment: string) => Promise<KickResult>;
  saveComment: (tag: string, comment: string) => Promise<KickResult>;
  removeKick: (tag: string) => Promise<{ ok: boolean; error?: string }>;
};

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return body?.error || fallback;
}

export const useKickListStore = create<KickListState>((set, get) => ({
  entries: [],
  departures: [],
  loading: true,
  toast: null,
  adding: false,
  savingTag: null,
  removingTag: null,

  setToast: (toast) => set({ toast }),

  async fetchAll() {
    set({ loading: true });
    try {
      const res = await fetch('/api/kicks');
      if (!res.ok) throw new Error(await errorOf(res, 'Failed to load the kick list'));
      const { entries, departures } = await res.json();
      set({ entries, departures, loading: false });
    } catch (err) {
      set({ loading: false, toast: { type: 'error', message: err instanceof Error ? err.message : 'Failed to load the kick list' } });
    }
  },

  async addKick(playerTag, comment) {
    if (get().adding) return { ok: false, error: 'Already adding an account' };
    set({ adding: true });
    try {
      const res = await fetch('/api/kicks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerTag, comment }),
      });
      if (!res.ok) return { ok: false, error: await errorOf(res, 'Failed to add to the kick list') };
      const entry = (await res.json()) as KickListEntry;
      // Newest first, and it is no longer a "was that a kick?" suggestion.
      set((s) => ({
        entries: [entry, ...s.entries.filter((e) => e.tag !== entry.tag)],
        departures: s.departures.filter((d) => d.tag !== entry.tag),
      }));
      return { ok: true, entry };
    } catch {
      return { ok: false, error: 'Failed to add to the kick list' };
    } finally {
      set({ adding: false });
    }
  },

  async saveComment(tag, comment) {
    if (get().savingTag) return { ok: false, error: 'Already saving' };
    set({ savingTag: tag });
    try {
      const res = await fetch(`/api/kicks/${encodeURIComponent(tag)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) return { ok: false, error: await errorOf(res, 'Failed to save the comment') };
      const entry = (await res.json()) as KickListEntry;
      set((s) => ({ entries: s.entries.map((e) => (e.tag === tag ? entry : e)) }));
      return { ok: true, entry };
    } catch {
      return { ok: false, error: 'Failed to save the comment' };
    } finally {
      set({ savingTag: null });
    }
  },

  async removeKick(tag) {
    if (get().removingTag) return { ok: false, error: 'Already removing' };
    set({ removingTag: tag });
    try {
      const res = await fetch(`/api/kicks/${encodeURIComponent(tag)}`, { method: 'DELETE' });
      if (!res.ok) return { ok: false, error: await errorOf(res, 'Failed to remove the entry') };
      set((s) => ({ entries: s.entries.filter((e) => e.tag !== tag) }));
      return { ok: true };
    } catch {
      return { ok: false, error: 'Failed to remove the entry' };
    } finally {
      set({ removingTag: null });
    }
  },
}));
