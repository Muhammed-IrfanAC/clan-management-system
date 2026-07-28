-- CWL: allocate per ACCOUNT, fill clans by an ordered PRIORITY, gate on a league SUB-DIVISION.
--
-- Three related changes to the CWL planning schema, all driven by the same realisation: the module
-- was modelling the family one level too coarsely.
--
--  1. PER-ACCOUNT ALLOCATION. `cwl_allocations` was keyed on person_id — one CWL slot per human —
--     so a leader with a main in the top clan and two alts could only ever sign ONE of them up, and
--     the engine silently picked which (main, else highest TH). But CWL signs up ACCOUNTS: an alt is
--     its own body in its own clan's roster. The subject moves person_id -> player_account_tag, the
--     same correction migration 020 made for strikes. person_id STAYS on every allocation (profile
--     link, display name, grouping a person's accounts in the UI); it is just no longer the key.
--
--  2. CLAN PRIORITY. `cwl_season_clans` gains `priority`. The engine used to spill surplus players
--     into whichever clan had the most room, which spreads bodies evenly but is the opposite of what
--     a clan family wants: the flagship clan should be filled FIRST and the feeders should absorb
--     what spills out, in an order leadership controls. priority 0 = filled first.
--
--  3. LEAGUE SUB-DIVISIONS. `player_accounts` gains `league_tier_id`, the official leagueTier id
--     (105000000–105000036) rather than only the raw display name. In-game each major tier has three
--     sub-divisions (Dragon 28 / 29 / 30, Legend III / II / I) and eligibility rules are written at
--     that granularity; storing the id makes the exact sub-division available without name parsing.
--     See src/lib/cwl/leagues.ts for the full transcribed table.
--
-- Frozen season `constraints` JSONB is deliberately NOT rewritten here. A season's rule snapshot is
-- history and must keep reading the way it was written; the legacy major-tier form
-- ({"minLeague":"dragon"}) is folded into the new sub-division form on read by
-- readAllocationRule() in src/lib/cwl/constraints.ts. New seasons write {"minLeagueTier":29}.

-- ---------------------------------------------------------------------------------------------
-- 1. Per-account allocations
-- ---------------------------------------------------------------------------------------------

ALTER TABLE cwl_allocations ADD COLUMN IF NOT EXISTS player_account_tag TEXT;

-- Backfill: an existing allocation belonged to whichever account the old engine would have fielded
-- for that person — main account first, else the earliest-added. That reproduces the historical
-- choice exactly, so past seasons keep pointing at the account that actually played.
UPDATE cwl_allocations a
SET player_account_tag = (
    SELECT pa.player_tag FROM player_accounts pa
    WHERE pa.person_id = a.person_id
    ORDER BY pa.is_main_account DESC, pa.th_level DESC NULLS LAST, pa.added_at ASC
    LIMIT 1
)
WHERE a.player_account_tag IS NULL;

-- A person with no surviving account has nothing to allocate — the row can no longer be acted on.
DELETE FROM cwl_allocations WHERE player_account_tag IS NULL;

ALTER TABLE cwl_allocations ALTER COLUMN player_account_tag SET NOT NULL;

-- CASCADE (not SET NULL as strikes use): an allocation is season PLANNING data that is meaningless
-- without its account, whereas a strike is a disciplinary record worth keeping as history. Cascading
-- also keeps sync.ts's bulk delete of long-departed accounts from tripping an FK violation.
ALTER TABLE cwl_allocations DROP CONSTRAINT IF EXISTS cwl_allocations_player_account_tag_fkey;
ALTER TABLE cwl_allocations
  ADD CONSTRAINT cwl_allocations_player_account_tag_fkey
  FOREIGN KEY (player_account_tag)
  REFERENCES player_accounts(player_tag)
  ON DELETE CASCADE;

-- Re-key the "nobody is in two clans" guarantee from the person to the account. This is the
-- structural half of the change: with the old constraint in place a person's second alt could not
-- be inserted at all.
ALTER TABLE cwl_allocations DROP CONSTRAINT IF EXISTS cwl_allocations_season_id_person_id_key;
ALTER TABLE cwl_allocations
  ADD CONSTRAINT cwl_allocations_season_id_player_account_tag_key
  UNIQUE (season_id, player_account_tag);

CREATE INDEX IF NOT EXISTS idx_cwl_allocations_account ON cwl_allocations (player_account_tag);

-- ---------------------------------------------------------------------------------------------
-- 2. Clan fill priority
-- ---------------------------------------------------------------------------------------------

ALTER TABLE cwl_season_clans ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 0;

-- Seed existing seasons with a deterministic order (by clan display name) so no two clans in a
-- season share a priority before a leader has arranged them.
WITH ordered AS (
  SELECT sc.id, ROW_NUMBER() OVER (PARTITION BY sc.season_id ORDER BY c.display_name, sc.id) - 1 AS pos
  FROM cwl_season_clans sc
  JOIN clans c ON c.id = sc.clan_id
)
UPDATE cwl_season_clans sc SET priority = ordered.pos
FROM ordered WHERE ordered.id = sc.id;

-- ---------------------------------------------------------------------------------------------
-- 3. Exact Ranked league sub-division
-- ---------------------------------------------------------------------------------------------

-- Nullable: an account synced before this column existed (or with no ranked standing) simply has
-- none, and normalizeLeagueTier() falls back to parsing the stored `league` name. Re-run a sync to
-- populate it.
ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS league_tier_id INTEGER;
