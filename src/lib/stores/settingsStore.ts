import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Clan, Rule, Setting, AccessRole, RuleAutomationMode } from '@/types/database';
import type { Capability } from '@/lib/permissions';
import type { ToastState } from '@/components/ui/Toast';

// Effective on/off state for the configurable co-leader capabilities, as served by /api/permissions.
export type CoLeaderCaps = Partial<Record<Capability, boolean>>;

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

// The Discord routing override as the client is allowed to see it: whether the redirect is on, and a
// masked fingerprint of the destination. The full URL is write-only from here.
export type DiscordRoute = {
  enabled: boolean;
  maskedUrl: string | null;
  configured: boolean;
  // The announcement channel (migration 029). Not configured = announcements inherit the clan channel.
  maskedAnnouncementUrl: string | null;
  announcementConfigured: boolean;
  // The leadership channel (migration 035). Not configured = leadership alerts inherit the clan channel.
  maskedLeadershipUrl: string | null;
  leadershipConfigured: boolean;
  // The unlinked-join channel (migration 036). Not configured = inherits the leadership channel.
  maskedUnlinkedUrl: string | null;
  unlinkedConfigured: boolean;
  // Bot routing (migration 037). Each channel id is preferred over its webhook while the bot is
  // configured; without DISCORD_BOT_TOKEN they are stored but unused.
  botConfigured: boolean;
  overrideChannelId: string | null;
  announcementChannelId: string | null;
  leadershipChannelId: string | null;
  unlinkedChannelId: string | null;
};

export type DiscordChannelField = 'overrideChannelId' | 'announcementChannelId' | 'leadershipChannelId' | 'unlinkedChannelId';

// One row of the bot's channel-access check (POST /api/settings/discord-route/check).
export type DiscordChannelCheck = { label: string; channelId: string; ok: boolean; name?: string; error?: string };

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
// Discord channel routing is configured through its own masked API route, not the generic settings
// blob: a webhook URL is a secret (holding it is enough to post as the bot), so it must never reach
// the browser. Every one of these keys is filtered out here and rendered by their own control — the
// bot channel ids (migration 037) too, which are not secret but belong to the same control.
export const DISCORD_ROUTE_KEYS = [
  'discord_override_enabled',
  'discord_override_webhook_url',
  'discord_override_channel_id',
  'discord_announcement_webhook_url',
  'discord_announcement_channel_id',
  'discord_leadership_webhook_url',
  'discord_leadership_channel_id',
  'discord_unlinked_webhook_url',
  'discord_unlinked_channel_id',
];

async function loadAll() {
  const { data: s } = await supabase
    .from('settings')
    .select('*')
    .not('key', 'in', `(${DISCORD_ROUTE_KEYS.join(',')})`);
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
    .is('person.access_role', null)
    // A person whose every account is inactive has left the family; they are not a candidate.
    .neq('status', 'inactive');
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

  // Co-leader permissions editor (super_admin only).
  coLeaderCaps: CoLeaderCaps;
  permsLoading: boolean;
  savingCap: Capability | null;

  setToast: (toast: ToastState | null) => void;
  fetchData: () => Promise<void>;
  refresh: () => Promise<void>;

  fetchPermissions: () => Promise<void>;
  toggleCapability: (cap: Capability, enabled: boolean) => Promise<void>;

  updateSetting: (key: string, value: unknown) => Promise<void>;

  discordRoute: DiscordRoute | null;
  savingDiscordRoute: boolean;
  fetchDiscordRoute: () => Promise<void>;
  saveDiscordRoute: (patch: {
    webhookUrl?: string;
    enabled?: boolean;
    announcementWebhookUrl?: string;
    leadershipWebhookUrl?: string;
    unlinkedWebhookUrl?: string;
  } & Partial<Record<DiscordChannelField, string>>) => Promise<boolean>;
  discordCheck: { bot: string | null; checks: DiscordChannelCheck[] } | null;
  checkingDiscord: boolean;
  checkDiscordChannels: () => Promise<void>;
  syncingCommands: boolean;
  syncDiscordCommands: () => Promise<void>;
  updateClanChannel: (id: string, channelId: string) => Promise<boolean>;

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

  coLeaderCaps: {},
  permsLoading: true,
  savingCap: null,

  discordRoute: null,
  savingDiscordRoute: false,
  discordCheck: null,
  checkingDiscord: false,
  syncingCommands: false,

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

  // Routed through /api/settings/discord-route rather than PostgREST — the webhook URL is a secret
  // and the route is what masks it. A non-leader simply gets no control (the GET 403s).
  async fetchDiscordRoute() {
    try {
      const res = await fetch('/api/settings/discord-route');
      if (!res.ok) return;
      set({ discordRoute: (await res.json()) as DiscordRoute });
    } catch (err) {
      console.error('Error loading Discord routing:', err);
    }
  },

  async saveDiscordRoute(patch) {
    if (get().savingDiscordRoute) return false;
    set({ savingDiscordRoute: true });
    try {
      const res = await fetch('/api/settings/discord-route', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Error updating notification routing');
      const next = body as DiscordRoute;
      // Report what the leader just changed, not the whole routing posture: saving an announcement
      // channel while the override happens to be on must not read as "the override was saved".
      const channelField = (Object.keys(patch) as string[]).find((k) => k.endsWith('ChannelId'));
      const message = channelField
        ? next[channelField as DiscordChannelField]
          ? 'Bot channel saved.'
          : 'Bot channel cleared — that route uses its webhook again.'
        : patch.announcementWebhookUrl !== undefined
        ? next.announcementConfigured
          ? 'Announcements will post to the announcement channel.'
          : 'Announcement channel cleared — announcements go to each clan’s channel.'
        : patch.leadershipWebhookUrl !== undefined
          ? next.leadershipConfigured
            ? 'Leadership alerts will post to the leadership channel.'
            : 'Leadership channel cleared — leadership alerts go to each clan’s channel.'
          : patch.unlinkedWebhookUrl !== undefined
            ? next.unlinkedConfigured
              ? 'Unlinked-join alerts will post to the unlinked-join channel.'
              : 'Unlinked-join channel cleared — those alerts go to the leadership channel.'
          : next.enabled
          ? 'All notifications are going to the override channel.'
          : 'Notifications are routed to the normal clan channels.';
      set({ discordRoute: next, toast: { message, type: 'success' } });
      return true;
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Error updating notification routing', type: 'error' } });
      return false;
    } finally {
      set({ savingDiscordRoute: false });
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

  // Run the bot's channel-access check. Not optimistic: the result IS the server's answer.
  async checkDiscordChannels() {
    if (get().checkingDiscord) return;
    set({ checkingDiscord: true });
    try {
      const res = await fetch('/api/settings/discord-route/check', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Error checking Discord channels');
      set({ discordCheck: body });
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Error checking Discord channels', type: 'error' } });
    } finally {
      set({ checkingDiscord: false });
    }
  },

  // Push the slash-command definitions to Discord (after setup, or after a definition changes).
  async syncDiscordCommands() {
    if (get().syncingCommands) return;
    set({ syncingCommands: true });
    try {
      const res = await fetch('/api/discord/commands', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Error syncing slash commands');
      const where = body.scope === 'guild' ? 'the family server' : 'all servers (may take up to an hour)';
      set({ toast: { message: `Synced /${(body.names as string[]).join(', /')} to ${where}.`, type: 'success' } });
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Error syncing slash commands', type: 'error' } });
    } finally {
      set({ syncingCommands: false });
    }
  },

  // Set (or clear, with '') a clan's bot channel. Splices the normalised id the server stored.
  async updateClanChannel(id, channelId) {
    try {
      const res = await fetch(`/api/clans/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discord_channel_id: channelId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Error updating clan channel');
      set({
        clans: get().clans.map((c) => (c.id === id ? { ...c, discord_channel_id: body.discord_channel_id ?? null } : c)),
        toast: { message: body.discord_channel_id ? 'Clan channel saved.' : 'Clan channel cleared.', type: 'success' },
      });
      return true;
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Error updating clan channel', type: 'error' } });
      return false;
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

  async fetchPermissions() {
    set({ permsLoading: true });
    try {
      const res = await fetch('/api/permissions');
      if (!res.ok) throw new Error('Failed to load permissions');
      const body = await res.json();
      set({ coLeaderCaps: (body.capabilities as CoLeaderCaps) || {}, permsLoading: false });
    } catch (err) {
      set({ permsLoading: false, toast: { message: err instanceof Error ? err.message : 'Error loading permissions', type: 'error' } });
    }
  },

  async toggleCapability(cap, enabled) {
    if (get().savingCap) return;
    set({ savingCap: cap });
    try {
      const res = await fetch('/api/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capability: cap, enabled }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Error updating permission');
      }
      const body = await res.json();
      set({
        coLeaderCaps: (body.capabilities as CoLeaderCaps) || {},
        toast: { message: `Co-leaders ${enabled ? 'granted' : 'revoked'}: ${cap}.`, type: 'success' },
      });
    } catch (err) {
      set({ toast: { message: err instanceof Error ? err.message : 'Error updating permission', type: 'error' } });
    } finally {
      set({ savingCap: null });
    }
  },
}));
