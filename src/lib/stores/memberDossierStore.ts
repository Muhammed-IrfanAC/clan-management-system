/**
 * Zustand store for the Member Dossier screen (`/dashboard/members/[id]`).
 *
 * Why a store: the profile is a deep object (accounts + strikes + activity + notes + onboarding
 * events) that several sibling cards render. Previously every mutation on the page — post a note,
 * tick an onboarding step, save a Discord id — re-fetched the ENTIRE profile, which flashed the
 * whole page. The store instead applies each mutation GRANULARLY (splice the changed slice of
 * `person` in place) so only the affected card re-renders, and it owns the server truth that the
 * (otherwise deeply prop-drilled) dossier cards each read directly.
 *
 * UI-local state (Discord/comment editor drafts, the confirm-delete modal) deliberately stays in
 * the components. The store holds server truth + the actions that mutate it, plus the transient
 * `toast` feedback those actions raise (centralised so any split card can surface it).
 */

import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type {
  Person,
  PlayerAccount,
  Strike,
  StrikeViolation,
  LeadershipLog,
  Clan,
  Rule,
  MemberNote,
  OnboardingEvent,
  OnboardingEventType,
} from '@/types/database';
import type { Capability } from '@/lib/permissions';
import type { ToastState } from '@/components/ui/Toast';

export type FullPerson = Person & {
  player_accounts: (PlayerAccount & { clan: Clan })[];
  strikes: (Strike & { rule: Rule | null; strike_violations: StrikeViolation[] })[];
  activity_logs: LeadershipLog[];
  member_notes: MemberNote[];
  onboarding_events: OnboardingEvent[];
};

// Result of a destructive account action, so the component can route away when the persona
// no longer has any accounts (the store can't use next/navigation).
export type MutationResult = { ok: boolean; navigateAway: boolean };

type DossierState = {
  personId: string | null;
  person: FullPerson | null;
  loggerNames: Record<string, string>;
  // author player_tag -> person_id, so alts of an author inherit that author's edit/delete controls.
  authorPersons: Record<string, string | null>;
  babyTrialDays: number;
  familyClans: Clan[];
  currentUserTag: string | null;
  currentUserName: string | null;
  myPersonId: string | null;
  // The acting leader's EFFECTIVE capabilities (coded defaults + runtime overrides), for UI gating.
  myCapabilities: Capability[];
  loading: boolean;
  toast: ToastState | null;

  // Per-action in-flight guards (each card shows its own saving state, not the whole page).
  recordingEvent: boolean;
  deletingEvent: boolean;
  removing: boolean;
  deletingPerson: boolean;
  postingComment: boolean;
  savingEdit: boolean;
  deletingCommentId: string | null;
  savingDiscord: boolean;

  setToast: (toast: ToastState | null) => void;
  loadIdentity: () => Promise<void>;
  loadFamilyClans: () => Promise<void>;
  fetchPerson: (id: string) => Promise<void>;
  recordOnboardingEvent: (
    eventType: OnboardingEventType,
    opts?: { outcome?: 'replied' | 'ignored'; clanId?: string },
  ) => Promise<void>;
  deleteOnboardingEvent: (eventId: string) => Promise<void>;
  saveDiscordId: (value: string) => Promise<boolean>;
  addComment: (body: string) => Promise<boolean>;
  saveCommentEdit: (commentId: string, body: string) => Promise<boolean>;
  deleteComment: (commentId: string) => Promise<boolean>;
  removePlayer: (tag: string) => Promise<MutationResult>;
  unlinkPlayer: (tag: string) => Promise<MutationResult>;
  deletePerson: () => Promise<MutationResult>;
  isAuthoredByMe: (authorTag: string | null) => boolean;
};

// Patch just one slice of `person` (never rebuild the whole profile) so a single card re-renders.
function patchPerson(
  set: (fn: (s: DossierState) => Partial<DossierState>) => void,
  updater: (p: FullPerson) => FullPerson,
) {
  set((s) => (s.person ? { person: updater(s.person) } : {}));
}

export const useMemberDossierStore = create<DossierState>((set, get) => ({
  personId: null,
  person: null,
  loggerNames: {},
  authorPersons: {},
  babyTrialDays: 4,
  familyClans: [],
  currentUserTag: null,
  currentUserName: null,
  myPersonId: null,
  myCapabilities: [],
  loading: true,
  toast: null,
  recordingEvent: false,
  deletingEvent: false,
  removing: false,
  deletingPerson: false,
  postingComment: false,
  savingEdit: false,
  deletingCommentId: null,
  savingDiscord: false,

  setToast(toast) {
    set({ toast });
  },

  async loadIdentity() {
    // Identify the acting leader (and their persona) so cards can show edit/delete on content
    // authored by them or any of their alts (same person_id).
    try {
      const r = await fetch('/api/auth/me');
      const d = r.ok ? await r.json() : null;
      set({
        currentUserTag: d?.user?.player_tag ?? null,
        currentUserName: d?.user?.in_game_name ?? null,
        myPersonId: d?.user?.person_id ?? null,
        myCapabilities: (d?.capabilities as Capability[] | undefined) ?? [],
      });
    } catch {
      /* identity is best-effort; ownership just falls back to tag equality */
    }
  },

  async loadFamilyClans() {
    // Family clans populate the onboarding clan-assignment dropdown (no hardcoded clans).
    const { data } = await supabase
      .from('clans')
      .select('*')
      .eq('active', true)
      .order('display_order');
    set({ familyClans: (data as Clan[]) || [] });
  },

  async fetchPerson(id) {
    set({ loading: true, personId: id });
    try {
      const { data: pData, error: pError } = await supabase
        .from('persons')
        .select(
          `
          *,
          player_accounts (
            *,
            clan:clans (*)
          ),
          strikes (
            *,
            rule:rules (*),
            strike_violations (*)
          ),
          activity_logs:leadership_logs (*),
          member_notes (*),
          onboarding_events (*)
        `,
        )
        .eq('id', id)
        .single();

      if (pError) throw pError;
      const person = pData as FullPerson;
      set({ person });

      const { data: trialSetting } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'baby_trial_days')
        .single();
      const parsedTrial = parseInt(String(trialSetting?.value ?? ''), 10);
      if (Number.isFinite(parsedTrial) && parsedTrial > 0) set({ babyTrialDays: parsedTrial });

      // Resolve player_tags (strike loggers + note authors + event actors) to display names.
      const loggerTags = Array.from(
        new Set(
          [
            ...(person?.strikes || []).map((s) => s.logged_by),
            ...(person?.member_notes || []).map((c) => c.author_tag),
            ...(person?.onboarding_events || []).map((e) => e.actor_tag),
          ].filter(Boolean) as string[],
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
      }
    } catch (err) {
      console.error('Error fetching person:', err);
    } finally {
      set({ loading: false });
    }
  },

  async recordOnboardingEvent(eventType, opts) {
    const { recordingEvent, personId, currentUserTag } = get();
    if (recordingEvent || !personId) return;
    set({ recordingEvent: true });
    // Optimistic: show the event immediately, persist in the background, reconcile on response.
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: OnboardingEvent = {
      id: tempId,
      person_id: personId,
      event_type: eventType,
      actor_tag: currentUserTag,
      outcome: opts?.outcome ?? null,
      clan_id: opts?.clanId ?? null,
      account_tag: null,
      metadata: {},
      created_at: new Date().toISOString(),
    };
    patchPerson(set, (p) => ({ ...p, onboarding_events: [...(p.onboarding_events || []), optimistic] }));
    try {
      const res = await fetch(`/api/onboarding/${personId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, outcome: opts?.outcome, clanId: opts?.clanId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to record action');
      const saved = await res.json();
      patchPerson(set, (p) => ({
        ...p,
        onboarding_events: (p.onboarding_events || []).map((e) => (e.id === tempId ? saved : e)),
      }));
    } catch (err: any) {
      patchPerson(set, (p) => ({
        ...p,
        onboarding_events: (p.onboarding_events || []).filter((e) => e.id !== tempId),
      }));
      set({ toast: { type: 'error', message: err.message || 'Error recording action' } });
    } finally {
      set({ recordingEvent: false });
    }
  },

  async deleteOnboardingEvent(eventId) {
    const { deletingEvent, personId } = get();
    if (deletingEvent || !personId) return;
    set({ deletingEvent: true });
    // Optimistic removal with revert on failure. Temp (unsaved) rows aren't deletable.
    let removed: OnboardingEvent | undefined;
    patchPerson(set, (p) => {
      removed = (p.onboarding_events || []).find((e) => e.id === eventId);
      return { ...p, onboarding_events: (p.onboarding_events || []).filter((e) => e.id !== eventId) };
    });
    try {
      const res = await fetch(`/api/onboarding/${personId}?eventId=${encodeURIComponent(eventId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to remove action');
    } catch (err: any) {
      if (removed) patchPerson(set, (p) => ({ ...p, onboarding_events: [...(p.onboarding_events || []), removed!] }));
      set({ toast: { type: 'error', message: err.message || 'Error removing action' } });
    } finally {
      set({ deletingEvent: false });
    }
  },

  async saveDiscordId(value) {
    const { savingDiscord, personId } = get();
    if (savingDiscord || !personId) return false;
    set({ savingDiscord: true });
    try {
      const res = await fetch(`/api/persons/${personId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discord_user_id: value.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save Discord ID');
      const saved = await res.json();
      patchPerson(set, (p) => ({ ...p, discord_user_id: saved.discord_user_id }));
      set({ toast: { type: 'success', message: saved.discord_user_id ? 'Discord linked.' : 'Discord unlinked.' } });
      return true;
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error saving Discord ID' } });
      return false;
    } finally {
      set({ savingDiscord: false });
    }
  },

  async addComment(body) {
    const trimmed = body.trim();
    const { personId, currentUserName } = get();
    if (!trimmed || !personId) return false;
    set({ postingComment: true });
    try {
      const res = await fetch('/api/members/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personId, body: trimmed }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to add comment');
      const note = (await res.json()) as MemberNote;
      // Splice the new note in place; ensure its author resolves to a name even if this leader
      // hasn't authored anything for this member before (no refetch needed).
      set((s) => {
        const loggerNames =
          currentUserName && note.author_tag && !s.loggerNames[note.author_tag]
            ? { ...s.loggerNames, [note.author_tag]: currentUserName }
            : s.loggerNames;
        return {
          loggerNames,
          person: s.person ? { ...s.person, member_notes: [...s.person.member_notes, note] } : s.person,
          toast: { type: 'success', message: 'Note added.' },
        };
      });
      return true;
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error adding comment' } });
      return false;
    } finally {
      set({ postingComment: false });
    }
  },

  async saveCommentEdit(commentId, body) {
    const trimmed = body.trim();
    if (!trimmed) return false;
    set({ savingEdit: true });
    try {
      const res = await fetch(`/api/members/notes/${commentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to save');
      const saved = (await res.json()) as MemberNote;
      patchPerson(set, (p) => ({
        ...p,
        member_notes: p.member_notes.map((n) => (n.id === commentId ? saved : n)),
      }));
      set({ toast: { type: 'success', message: 'Note updated.' } });
      return true;
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error saving comment' } });
      return false;
    } finally {
      set({ savingEdit: false });
    }
  },

  async deleteComment(commentId) {
    if (get().deletingCommentId) return false;
    set({ deletingCommentId: commentId });
    try {
      const res = await fetch(`/api/members/notes/${commentId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to delete');
      patchPerson(set, (p) => ({ ...p, member_notes: p.member_notes.filter((n) => n.id !== commentId) }));
      set({ toast: { type: 'success', message: 'Note deleted.' } });
      return true;
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error deleting comment' } });
      return false;
    } finally {
      set({ deletingCommentId: null });
    }
  },

  async removePlayer(tag) {
    const { removing, person } = get();
    if (removing) return { ok: false, navigateAway: false };
    set({ removing: true });
    const navigateAway = person?.player_accounts.length === 1;
    try {
      const res = await fetch(`/api/players/${encodeURIComponent(tag)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Error removing player');
      if (!navigateAway) {
        // Splice the removed account out; other slices are unaffected.
        patchPerson(set, (p) => ({ ...p, player_accounts: p.player_accounts.filter((a) => a.player_tag !== tag) }));
      }
      return { ok: true, navigateAway };
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error removing player' } });
      return { ok: false, navigateAway: false };
    } finally {
      set({ removing: false });
    }
  },

  async unlinkPlayer(tag) {
    const { person, personId } = get();
    const navigateAway = person?.player_accounts.length === 1;
    try {
      const { error } = await supabase.from('player_accounts').update({ person_id: null }).eq('player_tag', tag);
      if (error) throw error;
      if (navigateAway && personId) {
        await supabase.from('persons').delete().eq('id', personId);
      } else {
        patchPerson(set, (p) => ({ ...p, player_accounts: p.player_accounts.filter((a) => a.player_tag !== tag) }));
      }
      return { ok: true, navigateAway: !!navigateAway };
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error unlinking player' } });
      return { ok: false, navigateAway: false };
    }
  },

  // Delete the whole person: their accounts return to the Unlinked pool and the person + all their
  // strikes, notes and onboarding history are permanently removed (cascade in the API). Always
  // navigates away — the profile no longer exists.
  async deletePerson() {
    const { deletingPerson, personId } = get();
    if (deletingPerson || !personId) return { ok: false, navigateAway: false };
    set({ deletingPerson: true });
    try {
      const res = await fetch(`/api/persons/${personId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete person');
      return { ok: true, navigateAway: true };
    } catch (err: any) {
      set({ toast: { type: 'error', message: err.message || 'Error deleting person' } });
      return { ok: false, navigateAway: false };
    } finally {
      set({ deletingPerson: false });
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
