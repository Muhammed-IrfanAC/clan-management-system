-- Each account's finished Ranked League weeks, kept from the league history API (`ranked/leagueSync.ts`).
--
-- The API serves only the last ~5 weeks, and player_accounts.league_tier_id only today's tier. The attack
-- model needs more:
--   * a league tier carries over a TH upgrade but is far rarer at the old TH (Legend III is the top 0.08%
--     of TH17s, the top 11.5% of TH18s), so a player who just upgraded keeps the best standing of their
--     recent weeks, each read at the TH held that week (attackModel.ts `carriedStanding`);
--   * an attack stored before migration 048 has no league; the week's own tier is a far better stand-in
--     than today's.
--
-- th_level is the TH the account held that week (its latest war up to the week's end), not today's.
-- Rows are written once (ON CONFLICT DO NOTHING): a finished week does not change.
CREATE TABLE IF NOT EXISTS ranked_league_weeks (
  player_tag text NOT NULL REFERENCES player_accounts(player_tag) ON DELETE CASCADE,
  league_season_id bigint NOT NULL,           -- the week's start as Unix seconds (Monday 05:00 UTC)
  league_tier_id integer NOT NULL,            -- raw API tier id, as player_accounts.league_tier_id
  th_level integer,
  trophies integer,
  placement integer,
  attack_wins integer,
  attack_losses integer,
  defense_wins integer,
  defense_losses integer,
  defense_stars integer,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_tag, league_season_id)
);

-- API roles stay locked out (migration 042): only the secret key reaches data.
ALTER TABLE ranked_league_weeks ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON ranked_league_weeks TO service_role;

-- When sync last read the account's league history, so it is read once per finished week.
ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS league_history_checked_at timestamptz;
