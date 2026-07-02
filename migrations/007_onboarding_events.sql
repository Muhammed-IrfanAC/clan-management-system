-- Structured Onboarding System (AHA v1.0): turn routine onboarding steps into
-- structured, auto-stamped events instead of free-text notes. Each row is one
-- observable leadership action against a member's onboarding journey and becomes
-- permanent evidence for reports and future automation.
--
-- Stage is DERIVED from these events (not stored), so the event log is the single
-- source of truth. Notes remain for exceptional cases only.
--
-- Run manually against Supabase (migrations are not auto-applied). The member
-- profile embeds `onboarding_events (*)` and will error until this table exists.

CREATE TABLE IF NOT EXISTS onboarding_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id    UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,          -- engagement_attempt | rules_passed | linked_accounts_checked
                                        -- | additional_account_registered | assigned_clan
                                        -- | invited_discord | joined_discord | promoted_elder
  actor_tag    TEXT,                   -- player_tag of the acting leader; NULL = system/sync (auto-promotion)
  outcome      TEXT,                   -- 'replied' | 'ignored' (engagement_attempt only)
  clan_id      UUID REFERENCES clans(id) ON DELETE SET NULL,
  account_tag  TEXT,                   -- account-scoped events (additional account / clan assignment)
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_events_person_id ON onboarding_events (person_id);
