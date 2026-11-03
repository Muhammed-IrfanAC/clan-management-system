-- CWL WEEK PLANNER: the data the per-clan planner (src/lib/cwl/planner.ts) needs beyond what the
-- roster engine already stores.
--
-- The planner's goal is every account at 8★ by the end of the season, then the most clan stars.
-- It decides who plays which war from three leader inputs and one game input, each below.

-- 1. STANDING CWL FLAGS, per account.
--
-- `banned`        — never planned into a CWL war.
-- `rule_breaker`  — still planned, but their 8★ ranks below every clean account's.
--
-- Standing on purpose: a flag stays until a leader removes it, across seasons, so there is no season
-- column. These replace the strike system's influence on CWL entirely — strikes no longer exclude an
-- account from the roster; only a leader's flag does.

--
-- Keyed by TAG with no foreign key, like the per-war overrides below: an account signed into CWL may
-- not be in player_accounts at all (never synced, or left the clan after signing up), and leadership
-- must still be able to flag it.

CREATE TABLE IF NOT EXISTS cwl_player_flags (
  player_account_tag TEXT NOT NULL,
  flag TEXT NOT NULL CHECK (flag IN ('banned', 'rule_breaker')),
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (player_account_tag, flag)
);

-- Migration 042: API roles get nothing, RLS on with no policies, only the app's role is granted.
ALTER TABLE cwl_player_flags ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON cwl_player_flags TO service_role;

-- 2. PER-WAR OVERRIDES.
--
-- A leader forcing an account into, or out of, ONE specific war: "can't play Thursday", "we promised
-- them day 5". It applies to that war only and is never carried to another round; it wins over
-- everything the planner would otherwise decide, flags included. One row per account per round — an
-- account is in exactly one clan per season, so (season, round, tag) is the identity; clan_id is
-- kept for scoping reads.

CREATE TABLE IF NOT EXISTS cwl_round_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES cwl_seasons(id) ON DELETE CASCADE,
  clan_id UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  round_number INT NOT NULL CHECK (round_number BETWEEN 1 AND 7),
  player_account_tag TEXT NOT NULL, -- no FK: forcing out a signed-up account we never synced must work
  mode TEXT NOT NULL CHECK (mode IN ('in', 'out')),
  reason TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (season_id, round_number, player_account_tag)
);

CREATE INDEX IF NOT EXISTS idx_cwl_round_overrides_season_clan ON cwl_round_overrides (season_id, clan_id);

-- Migration 042: API roles get nothing, RLS on with no policies, only the app's role is granted.
ALTER TABLE cwl_round_overrides ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON cwl_round_overrides TO service_role;

-- 3. HOW A CLAN ASSIGNS TARGETS.
--
-- 'mirror' (position k hits position k) is the rule in the main clans and the only mode the planner
-- implements today. 'optimal' (planner-suggested targets) is reserved for the mini clan.

ALTER TABLE cwl_season_clans
  ADD COLUMN IF NOT EXISTS targeting TEXT NOT NULL DEFAULT 'mirror'
  CHECK (targeting IN ('mirror', 'optimal'));

-- 4. THE OPPONENTS.
--
-- The league group lists every clan in it with its signed roster, from the first prep day — and
-- each clan meets every other once, so before a round is drawn we already know WHO is left, just
-- not the order. The DRAWN opponent's lineup is already kept (cwl_rounds.opponent_lineup, migration
-- 016); the rosters of the clans not yet drawn were fetched by live.ts and thrown away.
--
-- cwl_group_clans: one row per clan in our clan's group, its signed members as [{tag,name,th}].
-- Our OWN clan's row (is_own) is the in-game signup list: the planner's roster comes from it, so an
-- account signed into CWL is planned whether or not it is linked to a person — unlinked accounts are
-- rare in the main clans but routine in the mini clan, and they need their 8★ as much as anyone.

CREATE TABLE IF NOT EXISTS cwl_group_clans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES cwl_seasons(id) ON DELETE CASCADE,
  clan_id UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE, -- OUR family clan
  opponent_tag TEXT NOT NULL,
  opponent_name TEXT,
  members JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_own BOOLEAN NOT NULL DEFAULT FALSE,
  polled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (season_id, clan_id, opponent_tag)
);

CREATE INDEX IF NOT EXISTS idx_cwl_group_clans_season_clan ON cwl_group_clans (season_id, clan_id);

-- Migration 042: API roles get nothing, RLS on with no policies, only the app's role is granted.
ALTER TABLE cwl_group_clans ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON cwl_group_clans TO service_role;

-- 5. PARTIAL OPT-OUTS RETIRE.
--
-- Migration 032's round windows ("away until round 3") are superseded by the per-war overrides
-- above, which say the same thing one war at a time and are what the planner reads. A whole-season
-- opt-out stays: it is an allocation exclusion, not a lineup decision.
--
-- Existing windows are carried over as 'out' overrides for each round they covered, on the clan the
-- account is rostered in (an account with no clan has no war to be kept out of), then removed.

-- Guarded on the columns existing, so the migration is safe to run on a database where they are
-- already gone (the carry-over has nothing to carry once they are).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cwl_season_optouts' AND column_name = 'unavailable_from_round'
  ) THEN
    INSERT INTO cwl_round_overrides (season_id, clan_id, round_number, player_account_tag, mode, reason, created_by)
    SELECT o.season_id, a.recommended_clan_id, r.n, o.player_account_tag, 'out',
           COALESCE(o.reason, 'Carried over from a partial-season opt-out'), COALESCE(o.created_by, 'migration')
    FROM cwl_season_optouts o
    JOIN cwl_allocations a
      ON a.season_id = o.season_id AND a.player_account_tag = o.player_account_tag
    JOIN generate_series(1, 7) AS r(n)
      ON r.n BETWEEN o.unavailable_from_round AND o.unavailable_to_round
    WHERE o.unavailable_from_round IS NOT NULL
      AND a.recommended_clan_id IS NOT NULL
    ON CONFLICT (season_id, round_number, player_account_tag) DO NOTHING;

    DELETE FROM cwl_season_optouts WHERE unavailable_from_round IS NOT NULL;
  END IF;
END $$;

ALTER TABLE cwl_season_optouts DROP CONSTRAINT IF EXISTS cwl_season_optouts_window_check;
ALTER TABLE cwl_season_optouts
  DROP COLUMN IF EXISTS unavailable_from_round,
  DROP COLUMN IF EXISTS unavailable_to_round;

-- 6. THE NEXT-WAR LINEUP POST.
--
-- One living Discord message per clan per war (nextLineupPostNotify.ts): re-posting the same war edits
-- it in place, so the channel never holds two contradicting lineups; the next war gets a fresh
-- message, because an edit does not notify anyone and a new war is news.

ALTER TABLE cwl_season_clans
  ADD COLUMN IF NOT EXISTS lineup_message_id TEXT,
  ADD COLUMN IF NOT EXISTS lineup_message_round INT;
