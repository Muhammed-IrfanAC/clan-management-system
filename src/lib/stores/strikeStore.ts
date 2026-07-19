/**
 * Zustand store for the Strikes screen.
 *
 * Why a store: every leader action on this page (approve trust, tick removal, add/delete a note)
 * previously re-fetched the ENTIRE strike list, which flashed the whole page and collapsed open
 * dossiers. The store instead applies each mutation GRANULARLY — the API returns the changed row and
 * we splice it into place, so only the affected card re-renders. It also owns the server data the
 * page and the (otherwise deeply prop-drilled) DossierCard both read.
 *
 * UI-local state (open/expanded flags, drafts, modal visibility, summary selection) deliberately
 * stays in the component — the store holds server truth + the actions that mutate it.
 */

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Person, PlayerAccount, Rule, StrikeSuggestion } from '@/types/database';
import type { StrikeWithContext } from '@/lib/strikes/dossier';

// An account joined with the person it's linked to, so selecting the account resolves the person.
export type AccountWithPerson = PlayerAccount & { person: Pick<Person, 'id' | 'display_name'> | null };

// A queued judgement-rule detection (hit-up) awaiting a leader's confirm/dismiss.
export type ReviewItem = StrikeSuggestion & {
  person: Pick<Person, 'id' | 'display_name'> | null;
  rule: Pick<Rule, 'id' | 'name'> | null;
};

export type LogStrikeInput = {
  personId: string;
  playerTag: string;
  ruleId: string | null;
  description: string;
  issuedAt: string | null;
};

type StrikeState = {
  strikes: StrikeWithContext[];
  loggerNames: Record<string, string>;
  authorPersons: Record<string, string | null>;
  reviewItems: ReviewItem[];
  rules: Rule[];
  accounts: AccountWithPerson[];
  currentUserTag: string | null;
  myPersonId: string | null;
  loading: boolean;
  // Per-row in-flight guards (so a single card shows its own saving state, not the whole page).
  // `savingStrikeId` guards a whole strike's buttons; `savingAction` names the specific action in
  // flight so e.g. only the Approve button — not Mark Removed — shows its "Approving…" label.
  savingStrikeId: string | null;
  savingAction: string | null;
  postingNote: string | null;
  deletingNoteId: string | null;
  actingReviewId: string | null;

  loadIdentity: () => Promise<void>;
  fetchData: (selectedClanId: string) => Promise<void>;
  patchStrike: (id: string, patch: Record<string, unknown>, action?: string) => Promise<boolean>;
  addNote: (strikeId: string, body: string) => Promise<boolean>;
  deleteNote: (strikeId: string, noteId: string) => Promise<boolean>;
  deleteStrike: (id: string) => Promise<boolean>;
  logStrike: (input: LogStrikeInput, selectedClanId: string) => Promise<boolean>;
  actOnReview: (id: string, action: 'confirm' | 'dismiss', selectedClanId: string) => Promise<boolean>;
  isAuthoredByMe: (authorTag: string) => boolean;
};

// Merge a bare updated strike row (scalar columns only, no embeds) back onto the in-memory strike,
// preserving its person/rule/violations/notes embeds.
function mergeStrike(list: StrikeWithContext[], id: string, patch: Partial<StrikeWithContext>) {
  return list.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

export const useStrikeStore = create<StrikeState>((set, get) => ({
  strikes: [],
  loggerNames: {},
  authorPersons: {},
  reviewItems: [],
  rules: [],
  accounts: [],
  currentUserTag: null,
  myPersonId: null,
  loading: true,
  savingStrikeId: null,
  savingAction: null,
  postingNote: null,
  deletingNoteId: null,
  actingReviewId: null,

  async loadIdentity() {
    try {
      const r = await fetch('/api/auth/me');
      const d = r.ok ? await r.json() : null;
      set({ currentUserTag: d?.user?.player_tag ?? null, myPersonId: d?.user?.person_id ?? null });
    } catch {
      /* identity is best-effort; note-ownership just falls back to tag equality */
    }
  },

  async fetchData(selectedClanId) {
    set({ loading: true });
    try {
      const res = await fetch('/api/strikes');
      const data: StrikeWithContext[] = res.ok ? await res.json() : [];
      const list = Array.isArray(data) ? data : [];

      // Resolve logger + note-author + approver tags to display names / personas (no FK to accounts).
      const tags = Array.from(new Set(list.flatMap((s) => [
        s.logged_by,
        ...((s.strike_notes || []).map((n) => n.author_tag)),
        ...(s.approved_by ? [s.approved_by] : []),
      ]).filter(Boolean)));
      const loggerNames: Record<string, string> = {};
      const authorPersons: Record<string, string | null> = {};
      if (tags.length) {
        const { data: loggers } = await supabase
          .from('player_accounts')
          .select('player_tag, person_id, in_game_name, person:persons (display_name)')
          .in('player_tag', tags);
        type LoggerRow = {
          player_tag: string;
          person_id: string | null;
          in_game_name: string | null;
          person: { display_name: string } | null;
        };
        for (const l of (loggers as unknown as LoggerRow[]) || []) {
          loggerNames[l.player_tag] = l.person?.display_name || l.in_game_name || l.player_tag;
          authorPersons[l.player_tag] = l.person_id ?? null;
        }
      }

      const { data: rulesData } = await supabase.from('rules').select('*');

      // Pending review queue (hit-up). Best-effort — a failure must not blank the page.
      let reviewItems: ReviewItem[] = [];
      try {
        const rres = await fetch('/api/rules/review');
        const items = rres.ok ? await rres.json() : [];
        const rlist: ReviewItem[] = Array.isArray(items) ? items : [];
        reviewItems = selectedClanId === 'all' ? rlist : rlist.filter((i) => !i.clan_id || i.clan_id === selectedClanId);
      } catch {
        reviewItems = [];
      }

      const { data: accountsData } = await supabase
        .from('player_accounts')
        .select('*, person:persons (id, display_name)')
        .eq('status', 'active')
        .not('person_id', 'is', null)
        .order('in_game_name');

      set({
        strikes: list,
        loggerNames,
        authorPersons,
        rules: rulesData || [],
        reviewItems,
        accounts: (accountsData as AccountWithPerson[]) || [],
      });
    } catch (err) {
      console.error('Error fetching strikes:', err);
    } finally {
      set({ loading: false });
    }
  },

  async patchStrike(id, patch, action) {
    set({ savingStrikeId: id, savingAction: action ?? null });
    try {
      const res = await fetch(`/api/strikes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        // PATCH returns the updated row (scalar columns, no embeds) — merge it in place.
        const row = (await res.json()) as Partial<StrikeWithContext>;
        set((s) => ({ strikes: mergeStrike(s.strikes, id, row) }));
        return true;
      }
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Error updating strike');
      return false;
    } catch {
      alert('Error updating strike');
      return false;
    } finally {
      set({ savingStrikeId: null, savingAction: null });
    }
  },

  async addNote(strikeId, body) {
    const trimmed = body.trim();
    if (!trimmed) return false;
    set({ postingNote: strikeId });
    try {
      const res = await fetch(`/api/strikes/${strikeId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      if (res.ok) {
        const note = await res.json();
        set((s) => ({
          strikes: s.strikes.map((st) =>
            st.id === strikeId ? { ...st, strike_notes: [...(st.strike_notes || []), note] } : st,
          ),
        }));
        return true;
      }
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Error adding note');
      return false;
    } catch {
      alert('Error adding note');
      return false;
    } finally {
      set({ postingNote: null });
    }
  },

  async deleteNote(strikeId, noteId) {
    if (get().deletingNoteId) return false;
    set({ deletingNoteId: noteId });
    try {
      const res = await fetch(`/api/strikes/${strikeId}/notes/${noteId}`, { method: 'DELETE' });
      if (res.ok) {
        set((s) => ({
          strikes: s.strikes.map((st) =>
            st.id === strikeId
              ? { ...st, strike_notes: (st.strike_notes || []).filter((n) => n.id !== noteId) }
              : st,
          ),
        }));
        return true;
      }
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Error deleting note');
      return false;
    } catch {
      alert('Error deleting note');
      return false;
    } finally {
      set({ deletingNoteId: null });
    }
  },

  async deleteStrike(id) {
    try {
      const res = await fetch(`/api/strikes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        set((s) => ({ strikes: s.strikes.filter((st) => st.id !== id) }));
        return true;
      }
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Error deleting strike');
      return false;
    } catch {
      alert('Error deleting strike');
      return false;
    }
  },

  async logStrike(input, selectedClanId) {
    try {
      const res = await fetch('/api/strikes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (res.ok) {
        // A new strike arrives without its embeds resolved; refetch to pull person/rule/violations.
        await get().fetchData(selectedClanId);
        return true;
      }
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Error logging strike');
      return false;
    } catch {
      alert('Error logging strike');
      return false;
    }
  },

  async actOnReview(id, action, selectedClanId) {
    set({ actingReviewId: id });
    try {
      const res = await fetch(`/api/rules/review/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        set((s) => ({ reviewItems: s.reviewItems.filter((i) => i.id !== id) }));
        // A confirm folds the suggestion into a war strike (possibly a brand-new one) — refetch strikes.
        if (action === 'confirm') await get().fetchData(selectedClanId);
        return true;
      }
      const d = await res.json().catch(() => ({}));
      alert(d.error || 'Error updating review item');
      return false;
    } catch {
      alert('Error updating review item');
      return false;
    } finally {
      set({ actingReviewId: null });
    }
  },

  isAuthoredByMe(authorTag) {
    const { currentUserTag, myPersonId, authorPersons } = get();
    if (currentUserTag && authorTag === currentUserTag) return true;
    return !!myPersonId && authorPersons[authorTag] != null && authorPersons[authorTag] === myPersonId;
  },
}));
