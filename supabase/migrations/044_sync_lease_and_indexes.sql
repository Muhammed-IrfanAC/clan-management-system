-- `sync_lease` is a single row that `runFullSync` (lib/sync.ts) claims for the length of a pass, so the
-- cron and a dashboard sync cannot run the pipeline at the same time. Two overlapping passes double
-- every CoC and Discord call and can race the once-per-round CWL lineup notice into posting twice. A
-- claim older than the function's time limit belongs to a killed pass and is taken over.

CREATE TABLE IF NOT EXISTS sync_lease (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch'
);

INSERT INTO sync_lease (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- Migration 042: API roles get nothing, RLS on with no policies, only the app's role is granted.
ALTER TABLE sync_lease ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON sync_lease TO service_role;

-- Indexes on the columns the app filters and embeds on, none of which had one. `player_accounts` is
-- read on every page (the person -> accounts embeds, the live role check) and on every sync (roster by
-- clan, the left/inactive sweep); the round tables are scanned by state + end time by every detector.
CREATE INDEX IF NOT EXISTS idx_player_accounts_person ON player_accounts (person_id);
CREATE INDEX IF NOT EXISTS idx_player_accounts_clan_status ON player_accounts (clan_id, status);
CREATE INDEX IF NOT EXISTS idx_player_accounts_status_synced ON player_accounts (status, last_synced_at);
CREATE INDEX IF NOT EXISTS idx_warnings_account ON warnings (player_account_tag);
CREATE INDEX IF NOT EXISTS idx_strike_suggestions_person ON strike_suggestions (person_id);
CREATE INDEX IF NOT EXISTS idx_war_rounds_state_end ON war_rounds (state, end_time);
CREATE INDEX IF NOT EXISTS idx_cwl_rounds_state_end ON cwl_rounds (state, end_time);
