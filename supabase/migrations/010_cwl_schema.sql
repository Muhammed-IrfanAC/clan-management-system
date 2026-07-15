-- Clan War League (CWL) module — Phase 0 foundation schema.
--
-- CWL runs monthly across the clan family. This module is a planning/tracking layer
-- over READ-ONLY CoC API data: it never submits anything in-game. Every in-game action
-- (sign-up, transfers, lineup entry) stays a manual leader step guided by this tool.
--
-- These are the season-scoped core tables (seasons, clan pool, allocations, transfers).
-- Round-lineup and performance tables are intentionally deferred to their own phases so
-- we don't ship schema nothing reads yet.
--
-- Run manually against Supabase (migrations are not auto-applied).

-- One monthly CWL cycle. `constraints` is a FROZEN, versioned snapshot of the rule set
-- used to generate this season's allocation, so a completed roster stays explainable even
-- if global defaults change later. Simplified Phase-1 shape:
--   { "default": { "minThLevel": null, "minLeague": null, "maxBench": null },
--     "perClan": { "<clan_id>": {...} } }
-- where minLeague is a CoC Ranked league (skeleton..legend, see src/lib/cwl/leagues.ts),
-- maxBench caps a clan's bench (null = engine default of 5), and perClan[id] overrides default
-- per clan.
CREATE TABLE IF NOT EXISTS cwl_seasons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label          TEXT NOT NULL,           -- e.g. '2026-07'
  status         TEXT NOT NULL DEFAULT 'planning',
                                          -- planning | transfers_pending | signed_up | in_progress | completed
  constraints    JSONB NOT NULL DEFAULT '{"default":{"minThLevel":null,"minLeague":null,"maxBench":null},"perClan":{}}'::jsonb,
  last_polled_at TIMESTAMPTZ,             -- when CWL live state was last ingested (manual sync, for now)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The set of family clans participating this season (editable per season). `war_size`
-- is that clan's chosen roster size for the season (15 or 30).
CREATE TABLE IF NOT EXISTS cwl_season_clans (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id  UUID NOT NULL REFERENCES cwl_seasons(id) ON DELETE CASCADE,
  clan_id    UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  war_size   INTEGER NOT NULL DEFAULT 15, -- 15 | 30
  UNIQUE (season_id, clan_id)
);

-- One row per eligible player per season: the whole-family allocation pass. The UNIQUE
-- (season_id, person_id) constraint is what structurally guarantees "no player in two
-- clans" — a person can hold at most one allocation per season.
CREATE TABLE IF NOT EXISTS cwl_allocations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id           UUID NOT NULL REFERENCES cwl_seasons(id) ON DELETE CASCADE,
  person_id           UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  recommended_clan_id UUID REFERENCES clans(id) ON DELETE SET NULL,
  actual_clan_id      UUID REFERENCES clans(id) ON DELETE SET NULL, -- player's current in-game clan
  status              TEXT NOT NULL DEFAULT 'matches',
                                          -- matches | transfer_required | transferred | removed
  is_bench            BOOLEAN NOT NULL DEFAULT FALSE, -- ranked bench (sub) vs fighting roster
  rank                INTEGER,            -- ordering within the clan's list (lower = higher priority)
  note                TEXT,               -- optional reason captured on a manual insert/remove
  UNIQUE (season_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_cwl_allocations_season ON cwl_allocations (season_id);
CREATE INDEX IF NOT EXISTS idx_cwl_allocations_person ON cwl_allocations (person_id);

-- A required in-game clan move tied to an allocation. The transfer itself happens in-game;
-- a leader confirms completion via an in-app checkbox (status -> done).
CREATE TABLE IF NOT EXISTS cwl_transfers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_id  UUID NOT NULL REFERENCES cwl_allocations(id) ON DELETE CASCADE,
  from_clan_id   UUID REFERENCES clans(id) ON DELETE SET NULL,
  to_clan_id     UUID REFERENCES clans(id) ON DELETE SET NULL,
  deadline       TIMESTAMPTZ,            -- ahead of the destination clan's sign-up window
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | done | missed
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cwl_transfers_allocation ON cwl_transfers (allocation_id);
