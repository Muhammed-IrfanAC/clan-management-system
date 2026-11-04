-- IN-GAME WAR PREFERENCE, for the CWL war planner.
--
-- A player's war opt-in/opt-out toggle ("warPreference": "in" | "out") is only on the per-player
-- profile (/players/{tag}), not on the clan member list sync reads, so it is fetched separately
-- (cwl/warPreferenceSync.ts) — and only while it matters: for accounts signed into a CWL season
-- that is still running, at most every few minutes. The planner treats "out" as the player asking
-- to sit out the NEXT war only: it is a short-term toggle, so later, provisional wars still plan them.
--
-- `war_preference_checked_at` is when it was last read, so the page can say how fresh it is and the
-- refresh can skip accounts read recently. Both are NULL for an account never checked.

ALTER TABLE player_accounts
  ADD COLUMN IF NOT EXISTS war_preference TEXT CHECK (war_preference IN ('in', 'out')),
  ADD COLUMN IF NOT EXISTS war_preference_checked_at TIMESTAMPTZ;
