-- Clan War League (CWL) module — Phase 2: live round & performance ingestion.
--
-- Phase 0 (010) deliberately deferred the round-lineup and performance tables to their own
-- phase. This adds them. They are populated by src/lib/cwl/live.ts (syncCwlLiveState), which
-- polls each participating family clan's live league group via the READ-ONLY CoC API during a
-- normal roster sync. Nothing here is ever submitted in-game — it only records what the API
-- reports for rounds already played.
--
-- Run manually against Supabase (migrations are not auto-applied).

-- One row per (season, family clan, round): OUR side of that round's war. A round exists only
-- once its war tag is revealed; the row is upserted on every sync so state/stars advance from
-- preparation -> inWar -> warEnded in place.
CREATE TABLE IF NOT EXISTS cwl_rounds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id       UUID NOT NULL REFERENCES cwl_seasons(id) ON DELETE CASCADE,
  clan_id         UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE, -- OUR family clan
  round_number    INTEGER NOT NULL,        -- 1-based, index into the league group's rounds
  war_tag         TEXT,                     -- the revealed CWL war tag
  state           TEXT NOT NULL DEFAULT 'preparation', -- preparation | inWar | warEnded
  team_size       INTEGER,                  -- 15 | 30
  opponent_name   TEXT,
  opponent_tag    TEXT,
  our_stars       INTEGER NOT NULL DEFAULT 0,
  our_destruction NUMERIC  NOT NULL DEFAULT 0,
  our_attacks_used INTEGER NOT NULL DEFAULT 0,
  start_time      TIMESTAMPTZ,
  end_time        TIMESTAMPTZ,
  polled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (season_id, clan_id, round_number)
);

CREATE INDEX IF NOT EXISTS idx_cwl_rounds_season ON cwl_rounds (season_id);

-- One row per OUR member per round: their lineup slot and attack result. In CWL each member gets
-- exactly one attack, so attacks_used is 0 or 1; a 0 on a warEnded round is a missed attack.
-- person_id resolves the CoC player_tag back to a family person (NULL for unlinked/guest tags).
CREATE TABLE IF NOT EXISTS cwl_war_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id      UUID NOT NULL REFERENCES cwl_rounds(id) ON DELETE CASCADE,
  person_id     UUID REFERENCES persons(id) ON DELETE SET NULL,
  player_tag    TEXT NOT NULL,
  name          TEXT,
  th_level      INTEGER,
  map_position  INTEGER,
  attacks_used  INTEGER NOT NULL DEFAULT 0, -- 0 | 1
  stars         INTEGER NOT NULL DEFAULT 0,
  destruction   NUMERIC  NOT NULL DEFAULT 0,
  UNIQUE (round_id, player_tag)
);

CREATE INDEX IF NOT EXISTS idx_cwl_war_members_round ON cwl_war_members (round_id);
