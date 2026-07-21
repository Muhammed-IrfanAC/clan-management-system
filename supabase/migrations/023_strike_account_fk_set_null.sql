-- Strike ↔ account FK: destroy nothing on account cleanup.
--
-- `strikes.player_account_tag` originally referenced `player_accounts(player_tag)` with no ON DELETE
-- clause, so Postgres defaulted to NO ACTION (RESTRICT). That was an accident, not a decision: the
-- inactive-account cleanup in sync.ts issues a bulk DELETE of long-departed accounts, and any account
-- still carrying a strike made that DELETE raise an FK violation — which the caller swallows. Net
-- effect: striked left-accounts silently accumulated forever and every sync logged a failed delete.
--
-- Re-point the FK to ON DELETE SET NULL. A strike's real anchor is `person_id` (NOT NULL, ON DELETE
-- CASCADE) — that's the profile/Discord link and the one true purge path (person deletion / baby
-- expiry). `player_account_tag` is only the scoping/grouping key, and dossier.ts already falls back to
-- `player_account_tag ?? person_id`. So detaching a purged account keeps the disciplinary record
-- intact as history while letting roster housekeeping proceed. Strikes are still only ever truly
-- deleted by removing the person.
--
-- The companion guard in sync.ts keeps an account out of the cleanup set while it still has an ACTIVE
-- (within-90-day) strike, so this SET NULL only ever fires on strikes that have already aged out of
-- enforcement — history, not in-force discipline.

ALTER TABLE strikes DROP CONSTRAINT IF EXISTS strikes_player_account_tag_fkey;

ALTER TABLE strikes
  ADD CONSTRAINT strikes_player_account_tag_fkey
  FOREIGN KEY (player_account_tag)
  REFERENCES player_accounts(player_tag)
  ON DELETE SET NULL;
