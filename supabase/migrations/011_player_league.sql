-- Capture each account's Clash of Clans Ranked league (Oct 2025 revamp) so CWL eligibility can
-- gate on a minimum league (e.g. "Dragon and up"), not just Town Hall level.
--
-- Stores the RAW Ranked-tier name from the CoC API's `leagueTier` field (e.g. 'Titan League 25',
-- 'Electro League 31', 'Legend III', 'Unranked') — NOT the legacy trophy `league` field. The app
-- normalizes it to a major tier in src/lib/cwl/leagues.ts. Nullable: an account with no ranked
-- standing (or not yet re-synced after this migration) simply has no league.
--
-- Run manually against Supabase (migrations are not auto-applied). Re-run a sync afterwards to
-- populate the column.

ALTER TABLE player_accounts ADD COLUMN IF NOT EXISTS league TEXT;
