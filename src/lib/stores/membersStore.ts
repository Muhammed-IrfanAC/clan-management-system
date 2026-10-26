import { create } from 'zustand';
import type { Person, PlayerAccount, Clan } from '@/types/database';
import type { ToastState } from '@/components/ui/Toast';

export type AccountWithClan = PlayerAccount & { clan: Clan };
export type PersonWithAccounts = Person & { player_accounts: AccountWithClan[] };

// What the link modal collects. `personId` set = link to an existing person (alt link);
// otherwise a new person is created from `newPersonName`.
export type LinkPayload = {
  playerTag: string;
  personId: string | null;
  newPersonName: string | null;
};

// Persons are listed alphabetically by display name, matching the server `.order('display_name')`.
function sortMembers(members: PersonWithAccounts[]): PersonWithAccounts[] {
  return [...members].sort((a, b) => a.display_name.localeCompare(b.display_name));
}

type MembersState = {
  members: PersonWithAccounts[];
  unlinkedAccounts: AccountWithClan[];
  loading: boolean;
  linking: boolean;
  toast: ToastState | null;

  setToast: (toast: ToastState | null) => void;
  fetchData: (selectedClanId: string) => Promise<void>;
  linkAccount: (payload: LinkPayload) => Promise<boolean>;
};

export const useMembersStore = create<MembersState>((set) => ({
  members: [],
  unlinkedAccounts: [],
  loading: true,
  linking: false,
  toast: null,

  setToast: (toast) => set({ toast }),

  async fetchData(selectedClanId) {
    set({ loading: true });
    try {
      // Persons with their linked accounts plus the unlinked roster-review queue, in one round trip.
      // The clan filter narrows the *person list* only (a person appearing in the selected clan keeps
      // all their alts on the card); the server applies it.
      const res = await fetch(`/api/views/members?clanId=${encodeURIComponent(selectedClanId)}`);
      if (!res.ok) throw new Error(`Members load failed (${res.status})`);
      const data = await res.json();
      set({
        members: (data.members as PersonWithAccounts[]) || [],
        unlinkedAccounts: (data.unlinkedAccounts as AccountWithClan[]) || [],
        loading: false,
      });
    } catch (err) {
      console.error('Error fetching members:', err);
      set({ loading: false, toast: { message: 'Failed to load registry.', type: 'error' } });
    }
  },

  async linkAccount(payload) {
    set({ linking: true });
    try {
      const res = await fetch('/api/members/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to link');

      const personId: string | undefined = body.personId;

      // Granular update: the link route returns only { personId }, so re-read that one
      // person (with accounts) and splice it in — no full-registry reload / flash. This
      // one path covers both "link to existing" and "created a new person".
      if (personId) {
        const pres = await fetch(`/api/views/members?personId=${encodeURIComponent(personId)}`);
        const person = pres.ok ? ((await pres.json()).person as PersonWithAccounts | null) : null;
        set((s) => {
          const unlinkedAccounts = s.unlinkedAccounts.filter((a) => a.player_tag !== payload.playerTag);
          if (!person) return { unlinkedAccounts };
          const others = s.members.filter((m) => m.id !== person.id);
          return { unlinkedAccounts, members: sortMembers([...others, person]) };
        });
      }

      set({ linking: false, toast: { message: 'Account linked.', type: 'success' } });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error linking account';
      set({ linking: false, toast: { message, type: 'error' } });
      return false;
    }
  },
}));
