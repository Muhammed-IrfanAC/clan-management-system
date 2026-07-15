-- Baby ("new born") status for persons.
-- A person created during roster review can be flagged as a "baby": a probationary
-- member on a configurable countdown. A leader must promote them before the countdown
-- elapses, otherwise the system unlinks their account(s) and removes the person record,
-- returning the account to the Unlinked pool.

-- 1. Columns on persons
ALTER TABLE persons ADD COLUMN IF NOT EXISTS is_baby BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE persons ADD COLUMN IF NOT EXISTS baby_started_at TIMESTAMPTZ;

-- 2. Backfill: every existing person is a permanent member, not a baby.
UPDATE persons SET is_baby = FALSE WHERE is_baby IS NULL;

-- 3. Configurable trial window.
INSERT INTO settings (key, value, description) VALUES
('baby_trial_days', '4', 'Days a new "baby" member has to be promoted before the system auto-unlinks them')
ON CONFLICT (key) DO NOTHING;
