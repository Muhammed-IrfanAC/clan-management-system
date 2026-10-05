-- The KICK LIST: accounts leadership kicked, watched so a return to ANY family clan is noticed.
--
-- The trigger was a player kicked from one clan who simply joined another, unnoticed. The CoC API
-- has no kick event — sync only sees an account disappear, exactly as it sees a voluntary leave — so
-- a kick is a leader's statement, recorded here. Sync then watches for the kicked account, and every
-- other account linked to the same person, reappearing in any family clan, and alerts leadership.
--
-- 1. DEPARTED ACCOUNTS ARE NO LONGER DELETED.
--
-- Until now sync deleted an account `inactive_cleanup_days` (30) after it left. That deletion took
-- the person link with it, so a kicked player's alts stopped being recognisable as theirs, and the
-- kick list itself could not reference the account. Instead the account is now marked 'inactive':
-- hidden from the registry and every roster list, but kept. A returning player is reactivated by the
-- normal roster upsert, link intact. The setting keeps its key and value and only changes meaning.
--
-- The CHECK constraint is dropped by lookup rather than by name: the base schema declared it inline
-- (so it got a generated name), and prod's constraints have drifted from the files before.

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'player_accounts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE player_accounts DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE player_accounts ADD CONSTRAINT player_accounts_status_check
  CHECK (status IN ('active', 'left', 'removed', 'inactive'));

UPDATE settings
SET description = 'Days an account can be gone from every family clan before sync marks it inactive (hidden from the registry, never deleted)'
WHERE key = 'inactive_cleanup_days';

-- 2. THE KICK LIST.
--
-- One row per kicked ACCOUNT, keyed by its tag. It references player_accounts: now that accounts are
-- never auto-deleted the row is always there, and the link is what lets the watch reach the person
-- and their alts. A tag kicked before it was ever synced gets an 'inactive' account row created
-- from the CoC API first. The FK is deliberately NO ACTION: permanently deleting a listed account
-- would silently lift the ban, so the API refuses it until the entry is removed.
--
-- Accounts linked to a person with dashboard access are never listed (co-leaders kick their own alts
-- to make room) — enforced in the API and again when the list and the watch are read, since an
-- account can be linked to leadership after it was listed.

CREATE TABLE IF NOT EXISTS kicked_accounts (
  player_tag TEXT PRIMARY KEY REFERENCES player_accounts(player_tag),
  kicked_from_clan_id UUID REFERENCES clans(id) ON DELETE SET NULL,
  comment TEXT,
  kicked_by TEXT NOT NULL,
  kicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- Explicit, because newer Supabase stacks no longer auto-grant new public tables to the API roles,
-- and the app talks to the database with the anon key.
GRANT SELECT, INSERT, UPDATE, DELETE ON kicked_accounts TO anon, authenticated, service_role;

-- 3. A LEADERSHIP CHANNEL for the alert.
--
-- The alert names the player and why they were kicked, which is leadership's business rather than
-- the clan's. Same shape and rules as the announcement channel (migration 029): a secret never sent
-- to the browser, and BLANK INHERITS — unset, alerts fall through to the clan channel.

INSERT INTO settings (key, value, description) VALUES
  (
    'discord_leadership_webhook_url',
    '""',
    'Channel for leadership-only alerts (kicked players rejoining). Blank = fall back to the clan channel. Never sent to the browser.'
  )
ON CONFLICT (key) DO NOTHING;
