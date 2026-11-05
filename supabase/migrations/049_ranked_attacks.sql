-- Ranked League attacks, kept so a later attack model can learn from them.
--
-- The CoC API serves only an account's last ~50 battles (Ranked, multiplayer and defences mixed), which
-- reaches back as little as 40 hours, so an attack not stored within a few days is gone for good. Sync
-- reads each active account's battle log every few hours (`ranked/attackSync.ts`) and keeps its Ranked
-- attacks here. Rows are written once (ON CONFLICT DO NOTHING): the first sighting wins.
--
-- attacker_th — the account's TH when the attack was first seen (the log does not carry it).
-- attacker_league_tier_id — the raw tier id of the Ranked week the attack was made in, or NULL when it
--   was first seen after that week had ended (the account's tier has moved on by then).
-- army_share_code — the army used, as the game's share code: free to keep now, unrecoverable later.
CREATE TABLE IF NOT EXISTS ranked_attacks (
  player_tag text NOT NULL REFERENCES player_accounts(player_tag) ON DELETE CASCADE,
  battle_at timestamptz NOT NULL,
  opponent_tag text NOT NULL,
  opponent_name text,
  opponent_th integer,
  attacker_th integer,
  attacker_league_tier_id integer,
  stars integer NOT NULL,
  destruction real NOT NULL,
  duration_seconds integer,
  army_share_code text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_tag, battle_at, opponent_tag)
);
CREATE INDEX IF NOT EXISTS idx_ranked_attacks_battle_at ON ranked_attacks (battle_at);

-- API roles stay locked out (migration 042): only the secret key reaches data.
ALTER TABLE ranked_attacks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON ranked_attacks TO service_role;

-- When sync last read the account's battle log, so each run reads only the ones that are due.
ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS battle_log_checked_at timestamptz;
