export type DatabaseRole = 'super_admin' | 'leader' | 'co_leader' | 'elder' | 'member';
export type PlayerStatus = 'active' | 'left' | 'removed';
export type ClanType = 'main' | 'feeder';
export type LogCategory = 'promotion' | 'demotion' | 'war' | 'recruitment' | 'capital' | 'general';

export interface Clan {
  id: string;
  clan_tag: string;
  display_name: string;
  clan_type: ClanType;
  display_order: number;
  active: boolean;
  created_at: string;
}

export interface Person {
  id: string;
  display_name: string;
  notes: string | null;
  is_baby: boolean;
  baby_started_at: string | null;
  created_at: string;
}

export interface PlayerAccount {
  player_tag: string;
  person_id: string | null;
  clan_id: string;
  is_main_account: boolean;
  db_role: DatabaseRole;
  access_enabled: boolean;
  status: PlayerStatus;
  added_at: string;
  in_game_name: string;
  th_level: number;
  trophies: number;
  donations: number;
  donations_received: number;
  last_synced_at: string;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  logging_guidance: string | null;
}

export interface Warning {
  id: string;
  person_id: string;
  player_account_tag: string;
  rule_id: string | null;
  description: string;
  logged_by: string;
  logged_at: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
  notes: string | null;
  edited_at: string | null;
}

export interface WarningNote {
  id: string;
  warning_id: string;
  author_tag: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface LeadershipLog {
  id: string;
  logged_by: string;
  logged_at: string;
  category: LogCategory;
  clan_id: string | null;
  related_person_id: string | null;
  description: string;
  pinned: boolean;
  edited_at: string | null;
}

export interface ActivityNote {
  id: string;
  log_id: string;
  author_tag: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface MemberNote {
  id: string;
  person_id: string;
  author_tag: string;
  body: string;
  created_at: string;
  updated_at: string;
}

export interface Setting {
  key: string;
  value: any;
  description: string | null;
  updated_at: string;
}

export type OnboardingEventType =
  | 'engagement_attempt'
  | 'rules_passed'
  | 'linked_accounts_checked'
  | 'additional_account_registered'
  | 'assigned_clan'
  | 'invited_discord'
  | 'joined_discord'
  | 'discord_waived'      // member has no Discord — the invite/join steps are skipped, not pending
  | 'promoted_elder';

export interface OnboardingEvent {
  id: string;
  person_id: string;
  event_type: OnboardingEventType;
  actor_tag: string | null;
  outcome: 'replied' | 'ignored' | null;
  clan_id: string | null;
  account_tag: string | null;
  metadata: Record<string, any>;
  created_at: string;
}
