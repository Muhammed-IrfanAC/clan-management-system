-- What each unlinked-join alert (036) is about, so a later sync can come back and correct it.
--
-- The alert used to be fire-and-forget: posted on the join, then only ever changed by a leader's
-- click. But a joiner often leaves again before anybody links them — hopped in, looked around, gone —
-- and the alert kept asking leadership to link a player who was no longer there. Sync already sees
-- the departure; what it lacked was a handle on the message. One row per (alert message, joiner): the
-- channel the bot ACTUALLY posted to (the routing override's, if that was on — a bot can only edit a
-- message through the channel it sits in) and the clan the joiner arrived in.
--
-- `closed_at` is set once the joiner needs nothing more from this alert: stamped as having left or
-- moved, or linked. Open rows are what each sync re-checks; rows are never deleted, so they double as
-- a log of who joined unlinked and how it ended.

CREATE TABLE IF NOT EXISTS unlinked_join_alerts (
  message_id TEXT NOT NULL,
  player_tag TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  clan_id UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  PRIMARY KEY (message_id, player_tag)
);

CREATE INDEX IF NOT EXISTS unlinked_join_alerts_open_idx
  ON unlinked_join_alerts (posted_at) WHERE closed_at IS NULL;

-- Explicit, because newer Supabase stacks no longer auto-grant new public tables to the API roles,
-- and the app talks to the database with the anon key.
GRANT SELECT, INSERT, UPDATE, DELETE ON unlinked_join_alerts TO anon, authenticated, service_role;
