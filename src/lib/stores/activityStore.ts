/**
 * Zustand store for the Leadership Activity screen (`/dashboard/activity`).
 *
 * Why a store: the page is a long feed of leadership logs, each with its own progress-note
 * thread and per-entry edit/delete/complete controls. Previously EVERY mutation — add an entry,
 * toggle complete, post/edit/delete a note — re-fetched the whole feed, which flashed the page
 * and collapsed any open note threads. The store instead applies each mutation GRANULARLY
 * (splice just the affected log/note in place) so only the touched card re-renders, and it owns
 * the server truth (logs + name/persona lookups + the clan/person option lists) that the split
 * cards each read directly.
 *
 * UI-local state (the status filter, add/edit modal orchestration, per-card note drafts and
 * "notes expanded" toggles) deliberately stays in the components. The store holds server truth +
 * the actions that mutate it, plus the transient `toast` feedback those actions raise (centralised
 * so any split card can surface it). Every API route returns the affected row, which is what makes
 * the granular splice possible without a refetch.
 */

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { LeadershipLog, Clan, Person, ActivityNote } from '@/types/database';
import type { ToastState } from '@/components/ui/Toast';

export type ExtendedLog = LeadershipLog & {
  clan: Clan | null;
  person: Person | null;
  completed: boolean;
  activity_notes: ActivityNote[];
};

export type LogForm = {
  category: string;
  clanId: string;
  personId: string;
  description: string;
  pinned: boolean;
};

type ActivityState = {
  logs: ExtendedLog[];
  loggerNames: Record<string, string>;
  // author player_tag -> person_id, so an author's alts inherit that author's edit/delete controls.
  authorPersons: Record<string, string | null>;
  clans: Clan[];
  persons: Person[];
  currentUserTag: string | null;
  currentUserName: string | null;
  myPersonId: string | null;
  loading: boolean;
  toast: ToastState | null;

  // Per-action in-flight guards (each card/modal shows its own saving state, not the whole page).
  addingLog: boolean;
  togglingId: string | null;
  deleting: boolean;
  savingEdit: boolean;
  postingNoteId: string | null;
  savingNote: boolean;
  deletingNoteId: string | null;

  setToast: (toast: ToastState | null) => void;
  loadIdentity: () => Promise<void>;
  fetchData: (clanId: string) => Promise<void>;
  addLog: (form: LogForm) => Promise<boolean>;
  toggleComplete: (id: string, current: boolean) => Promise<void>;
  saveEdit: (id: string, form: LogForm) => Promise<boolean>;
  deleteLog: (id: string) => Promise<boolean>;
  addNote: (logId: string, body: string) => Promise<boolean>;
  saveNote: (logId: string, noteId: string, body: string) => Promise<boolean>;
  deleteNote: (logId: string, noteId: string) => Promise<void>;
  isAuthoredByMe: (authorTag: string | null) => boolean;
};

// Feed ordering: pinned entries first, then newest-logged first — mirrors the PostgREST query so a
// spliced-in/edited row lands where a refetch would have put it.
function sortLogs(logs: ExtendedLog[]): ExtendedLog[] {
  return [...logs].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.logged_at).getTime() - new Date(a.logged_at).getTime();
  });
}

// PATCH/POST return the bare log row (no embeds). Re-derive clan/person from the cached option
// lists so a spliced row renders identically to a freshly-fetched one.
function deriveEmbeds(row: LeadershipLog, clans: Clan[], persons: Person[]) {
  return {
    clan: row.clan_id ? clans.find((c) => c.id === row.clan_id) ?? null : null,
    person: row.related_person_id ? persons.find((p) => p.id === row.related_person_id) ?? null : null,
  };
}

// Patch one log in place, preserving its note thread (`activity_notes` never comes back on a
// log PATCH), then re-sort in case pin/logged_at ordering changed.
function patchLog(
  set: (fn: (s: ActivityState) => Partial<ActivityState>) => void,
  id: string,
  row: LeadershipLog & { completed?: boolean },
) {
  set((s) => ({
    logs: sortLogs(
      s.logs.map((l) =>
        l.id === id
          ? { ...l, ...row, completed: row.completed ?? l.completed, activity_notes: l.activity_notes, ...deriveEmbeds(row, s.clans, s.persons) }
          : l,
      ),
    ),
  }));
}

// Patch a single note's thread within one log, without touching sibling logs.
function patchNotes(
  set: (fn: (s: ActivityState) => Partial<ActivityState>) => void,
  logId: string,
  updater: (notes: ActivityNote[]) => ActivityNote[],
) {
  set((s) => ({
    logs: s.logs.map((l) => (l.id === logId ? { ...l, activity_notes: updater(l.activity_notes || []) } : l)),
  }));
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  logs: [],
  loggerNames: {},
  authorPersons: {},
  clans: [],
  persons: [],
  currentUserTag: null,
  currentUserName: null,
  myPersonId: null,
  loading: true,
  toast: null,
  addingLog: false,
  togglingId: null,
  deleting: false,
  savingEdit: false,
  postingNoteId: null,
  savingNote: false,
  deletingNoteId: null,

  setToast(toast) {
    set({ toast });
  },

  async loadIdentity() {
    // Identify the acting leader (and their persona) so cards can show edit/delete on entries and
    // notes authored by them or any of their alts (same person_id).
    try {
      const r = await fetch('/api/auth/me');
      const d = r.ok ? await r.json() : null;
      set({
        currentUserTag: d?.user?.player_tag ?? null,
        currentUserName: d?.user?.in_game_name ?? null,
        myPersonId: d?.user?.person_id ?? null,
      });
    } catch {
      /* identity is best-effort; ownership just falls back to tag equality */
    }
  },

  async fetchData(clanId) {
    set({ loading: true });
    try {
      let req = supabase
        .from('leadership_logs')
        .select(
          `
          *,
          clan:clans (*),
          person:persons (*),
          activity_notes (*)
        `,
        )
        .order('pinned', { ascending: false })
        .order('logged_at', { ascending: false });

      if (clanId !== 'all') req = req.eq('clan_id', clanId);

      const { data } = await req;
      const logRows = (data as ExtendedLog[]) || [];
      set({ logs: logRows });

      // Resolve player_tags (entry loggers + note authors) to a display name and persona.
      const loggerTags = Array.from(
        new Set(
          logRows
            .flatMap((l) => [l.logged_by, ...((l.activity_notes || []).map((n) => n.author_tag))])
            .filter(Boolean) as string[],
        ),
      );
      if (loggerTags.length) {
        const { data: loggers } = await supabase
          .from('player_accounts')
          .select('player_tag, person_id, in_game_name, person:persons (display_name)')
          .in('player_tag', loggerTags);
        const names: Record<string, string> = {};
        const persons: Record<string, string | null> = {};
        for (const l of (loggers as any[]) || []) {
          names[l.player_tag] = l.person?.display_name || l.in_game_name || l.player_tag;
          persons[l.player_tag] = l.person_id ?? null;
        }
        set({ loggerNames: names, authorPersons: persons });
      } else {
        set({ loggerNames: {}, authorPersons: {} });
      }

      const { data: clansData } = await supabase.from('clans').select('*');
      set({ clans: (clansData as Clan[]) || [] });

      const { data: personsData } = await supabase.from('persons').select('*').order('display_name');
      set({ persons: (personsData as Person[]) || [] });
    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      set({ loading: false });
    }
  },

  async addLog(form) {
    if (get().addingLog) return false;
    set({ addingLog: true });
    try {
      const res = await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: form.category,
          clanId: form.clanId,
          personId: form.personId,
          description: form.description,
          pinned: form.pinned,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Error adding log');
      const row = (await res.json()) as LeadershipLog & { completed?: boolean };
      // Splice the created entry in with hydrated embeds + an empty note thread, then re-sort.
      set((s) => {
        const created: ExtendedLog = {
          ...row,
          completed: row.completed ?? false,
          activity_notes: [],
          ...deriveEmbeds(row, s.clans, s.persons),
        };
        return { logs: sortLogs([created, ...s.logs]), toast: { type: 'success', message: 'Entry added.' } };
      });
      return true;
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error adding log' } });
      return false;
    } finally {
      set({ addingLog: false });
    }
  },

  async toggleComplete(id, current) {
    if (get().togglingId === id) return;
    set({ togglingId: id });
    try {
      const res = await fetch(`/api/activity/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: !current }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Error updating log status');
      const row = (await res.json()) as LeadershipLog & { completed?: boolean };
      patchLog(set, id, row);
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error updating log status' } });
    } finally {
      set({ togglingId: null });
    }
  },

  async saveEdit(id, form) {
    set({ savingEdit: true });
    try {
      const res = await fetch(`/api/activity/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: form.category,
          clanId: form.clanId || null,
          personId: form.personId || null,
          description: form.description,
          pinned: form.pinned,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Error updating entry');
      const row = (await res.json()) as LeadershipLog & { completed?: boolean };
      patchLog(set, id, row);
      set({ toast: { type: 'success', message: 'Entry updated.' } });
      return true;
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error updating entry' } });
      return false;
    } finally {
      set({ savingEdit: false });
    }
  },

  async deleteLog(id) {
    if (get().deleting) return false;
    set({ deleting: true });
    try {
      const res = await fetch(`/api/activity/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Error deleting log');
      set((s) => ({ logs: s.logs.filter((l) => l.id !== id), toast: { type: 'success', message: 'Entry deleted.' } }));
      return true;
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error deleting log' } });
      return false;
    } finally {
      set({ deleting: false });
    }
  },

  async addNote(logId, body) {
    const trimmed = body.trim();
    const { currentUserName } = get();
    if (!trimmed) return false;
    set({ postingNoteId: logId });
    try {
      const res = await fetch(`/api/activity/${logId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Error adding note');
      const note = (await res.json()) as ActivityNote;
      // Splice the note into just this log's thread; ensure its author resolves to a name even if
      // this leader hasn't authored anything visible yet (no refetch needed).
      set((s) => {
        const loggerNames =
          currentUserName && note.author_tag && !s.loggerNames[note.author_tag]
            ? { ...s.loggerNames, [note.author_tag]: currentUserName }
            : s.loggerNames;
        return {
          loggerNames,
          logs: s.logs.map((l) => (l.id === logId ? { ...l, activity_notes: [...(l.activity_notes || []), note] } : l)),
        };
      });
      return true;
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error adding note' } });
      return false;
    } finally {
      set({ postingNoteId: null });
    }
  },

  async saveNote(logId, noteId, body) {
    const trimmed = body.trim();
    if (!trimmed) return false;
    set({ savingNote: true });
    try {
      const res = await fetch(`/api/activity/${logId}/notes/${noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Error saving note');
      const saved = (await res.json()) as ActivityNote;
      patchNotes(set, logId, (notes) => notes.map((n) => (n.id === noteId ? saved : n)));
      return true;
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error saving note' } });
      return false;
    } finally {
      set({ savingNote: false });
    }
  },

  async deleteNote(logId, noteId) {
    if (get().deletingNoteId === noteId) return;
    set({ deletingNoteId: noteId });
    try {
      const res = await fetch(`/api/activity/${logId}/notes/${noteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Error deleting note');
      patchNotes(set, logId, (notes) => notes.filter((n) => n.id !== noteId));
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error deleting note' } });
    } finally {
      set({ deletingNoteId: null });
    }
  },

  isAuthoredByMe(authorTag) {
    if (!authorTag) return false;
    const { currentUserTag, myPersonId, authorPersons } = get();
    if (currentUserTag && authorTag === currentUserTag) return true;
    const pid = authorPersons[authorTag] ?? null;
    return !!myPersonId && pid !== null && pid === myPersonId;
  },
}));
