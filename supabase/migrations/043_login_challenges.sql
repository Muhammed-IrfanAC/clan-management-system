-- Discord login codes (lib/auth/loginChallenge.ts).
--
-- A player tag is public, so it can no longer open a session by itself: login sends a one-time
-- code to the Discord account linked to the tag's person, and one row here records each code sent.
-- Only an HMAC of the code is stored (keyed by the server secret, bound to the row id). `attempts`
-- caps guesses per code; `created_at` per person drives the send rate limit; `consumed_at` makes a
-- code single-use. Rows are short-lived and worthless once expired — deleted with their person.

CREATE TABLE IF NOT EXISTS login_challenges (
  id UUID PRIMARY KEY,
  person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  player_tag TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS login_challenges_person_created_idx ON login_challenges (person_id, created_at DESC);

-- Migration 042: API roles get nothing, RLS on with no policies, only the app's role is granted.
ALTER TABLE login_challenges ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON login_challenges TO service_role;
