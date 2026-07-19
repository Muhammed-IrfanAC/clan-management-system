import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Clan, Rule, Setting, AccessRole, RuleAutomationMode } from '@/types/database';
import type { ToastState } from '@/components/ui/Toast';

// One access-holder row = a person (with access_role) plus a representative account for display.
export type LeaderRow = {
  player_tag: string;
  display_name: string;
  person_id: string;
  access_role: AccessRole;
};

// A registry person eligible to be granted access (no access_role yet), with a representative
// account tag so the person-addressed leaders API can resolve them.
export type PersonOption = {
  person_id: string;
  display_name: string;
  player_tag: string;
};

export type NewClan = { tag: string; name: string; type: string };
export type NewRule = { name: string; description: string; guidance: string };

type AcctRow = {
  player_tag: string;
  is_main_account: boolean;
  person_id: string;
  person: { access_role: AccessRole; display_name: string } | null;
};

// Collapse account rows to one row per person, preferring the main account, keeping only persons
// whose access_role matches the caller's predicate. Shared by the leaders list and the add picker.
function byPerson(accts: AcctRow[]): Map<string, LeaderRow> {
  const map = new Map<string, LeaderRow>();
  for (const a of accts) {
    if (!a.person_id || !a.person) continue;
    if (!map.has(a.person_id) || a.is_main_account) {
      map.set(a.person_id, {
        player_tag: a.player_tag,
        display_name: a.person.display_name,
        person_id: a.person_id,
        access_role: a.person.access_role,
      });
    }
  }
  return map;
}

// Read every server slice the Settings screen needs in one shot. Kept separate from the actions so
// both the initial load (with a loading flash) and post-mutation refreshes (silent) can reuse it.
async function loadAll() {
  const { data: s } = await supabase.from('settings').select('*');
  const { data: c } = await supabase.from('clans').select('*').order('display_order');
  const { data: r } = await supabase.from('rules').select('*');

  // Access-holders = persons with a non-null access_role, addressed via a representative account tag.
  const { data: accts } = await supabase
    .from('player_accounts')
    .select('player_tag, is_main_account, person_id, person:persons!inner(access_role, display_name)')
    .not('person.access_role', 'is', null);
  const leaders = [...byPerson((accts || []) as unknown as AcctRow[]).values()];

  // Candidate persons for the "Add Leader" picker: registry persons who do NOT yet hold access.
  const { data: candAccts } = await supabase
    .from('player_accounts')
    .select('player_tag, is_main_account, person_id, person:persons!inner(access_role, display_name)')
    .is('person.access_role', null);
  const personOptions = [...byPerson((candAccts || []) as unknown as AcctRow[]).values()]
    .map((l) => ({ person_id: l.person_id, display_name: l.display_name, player_tag: l.player_tag }))
    .sort((x, y) => x.display_name.localeCompare(y.display_name));

  return {
    appSettings: (s || []) as Setting[],
    clans: (c || []) as Clan[],
    rules: (r || []) as Rule[],
    leaders,
    personOptions,
  };
}

type SettingsState = {
  appSettings: Setting[];
  clans: Clan[];
  rules: Rule[];
  leaders: LeaderRow[];
  personOptions: PersonOption[];
  loading: boolean;
  togglingRuleId: string | null;
  toast: ToastState | null;

  setToast: (toast: ToastState | null) => void;
  fetchData: () => Promise<void>;
  refresh: () => Promise<void>;

  updateSetting: (key: string, value: unknown) => Promise<void>;

  addClan: (form: NewClan) => Promise<boolean>;
  removeClan: (id: string) => Promise<void>;
  updateClanAutomation: (id: string, mode: RuleAutomationMode) => Promise<void>;

  addRule: (form: NewRule) => Promise<boolean>;
  removeRule: (id: string) => Promise<void>;
  updateRuleAutomation: (id: string, patch: Record<string, unknown>) => Promise<void>;
  toggleRuleAutomation: (id: string, enabled: boolean) => Promise<void>;

  addLeader: (playerTag: string, role: AccessRole) => Promise<boolean>;
  revokeLeader: (playerTag: string) => Promise<void>;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  appSettings: [],
  clans: [],
  rules: [],
  leaders: [],
  personOptions: [],
  loading: true,
  togglingRuleId: null,
  toast: null,

  setToast: (toast) => set({ toast }),

  async fetchData() {
    set({ loading: true });
    try {
      set({ ...(await loadAll()), loading: false });
    } catch (err) {
      console.error('Error fetching settings:', err);
      set({ loading: false, toast: { message: 'Failed to load settings.', type: 'error' } });
    }
  },

  // Silent reload after a mutation — no loading flash, so the other tabs' data stays put.
  async refresh() {
    try {
      set(await loadAll());
    } catch (err) {
      console.error('Error refreshing settings:', err);
    }
  },

  async updateSetting(key, value) {
    // Optimistic: splice the new value in, revert if the write fails.
    const prev = get().appSettings;
    set({ appSettings: prev.map((s) => (s.key === key ? { ...s, value } : s)) });
    try {
      const { error } = await supabase.from('settings').update({ value }).eq('key', key);
      if (error) throw error;
    } catch {
      set({ appSettings: prev, toast: { message: 'Error updating setting.', type: 'error' } });
    }
  },

  async addClan(form) {
    try {
      const res = await fetch('/api/clans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clan_tag: form.tag.toUpperCase().startsWith('#') ? form.tag.toUpperCase() : `#${form.tag.toUpperCase()}`,
          display_name: form.name,
          clan_type: form.type,
          display_order: get().clans.length,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Error adding clan');
      }
      await get().refresh();
      set({ toast: { message: 'Clan registered.', type: 'success' } });
      return true;
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Error adding clan', type: 'error' } });
      return false;
    }
  },

  async removeClan(id) {
    try {
      const res = await fetch(`/api/clans/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Error removing clan');
      }
      await get().refresh();
      set({ toast: { message: 'Clan removed.', type: 'success' } });
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Error removing clan', type: 'error' } });
    }
  },

  // Set a clan's rule-automation scope (always / cwl_only / never). Optimistic; reverts on failure.
  async updateClanAutomation(id, mode) {
    const prev = get().clans;
    set({ clans: prev.map((c) => (c.id === id ? { ...c, rule_automation_mode: mode } : c)) });
    try {
      const res = await fetch(`/api/clans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule_automation_mode: mode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Error updating clan automation');
      }
    } catch (err) {
      set({ clans: prev, toast: { message: err instanceof Error ? err.message : 'Error updating clan automation', type: 'error' } });
    }
  },

  async addRule(form) {
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, description: form.description, logging_guidance: form.guidance }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Error adding rule');
      }
      await get().refresh();
      set({ toast: { message: 'Rule saved.', type: 'success' } });
      return true;
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Error adding rule', type: 'error' } });
      return false;
    }
  },

  async removeRule(id) {
    try {
      const res = await fetch(`/api/rules/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Failed to delete rule');
      }
      await get().refresh();
      set({ toast: { message: 'Rule deleted.', type: 'success' } });
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Failed to delete rule', type: 'error' } });
    }
  },

  // Persist a rule's automation wiring (detector, enable flag, or config); the rules API validates
  // the detector key. Silent refresh keeps the rest of the screen from flashing.
  async updateRuleAutomation(id, patch) {
    try {
      const res = await fetch(`/api/rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Error updating automation');
      }
      await get().refresh();
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Error updating automation', type: 'error' } });
    }
  },

  // Guarded enable/disable toggle so it can't be fired repeatedly mid-request.
  async toggleRuleAutomation(id, enabled) {
    if (get().togglingRuleId) return;
    set({ togglingRuleId: id });
    try {
      await get().updateRuleAutomation(id, { automation_enabled: enabled });
    } finally {
      set({ togglingRuleId: null });
    }
  },

  async addLeader(playerTag, role) {
    try {
      const res = await fetch(`/api/leaders/${encodeURIComponent(playerTag)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_role: role }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Error adding leader');
      }
      await get().refresh();
      set({ toast: { message: 'Dashboard access granted.', type: 'success' } });
      return true;
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Error adding leader', type: 'error' } });
      return false;
    }
  },

  async revokeLeader(playerTag) {
    try {
      const res = await fetch(`/api/leaders/${encodeURIComponent(playerTag)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_role: null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Error revoking access');
      }
      await get().refresh();
      set({ toast: { message: 'Access revoked.', type: 'success' } });
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Error revoking access', type: 'error' } });
    }
  },
}));
