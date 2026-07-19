-- Strikes become PER-ACCOUNT (not per-person).
--
-- A strike models an in-game disciplinary event, and in Clash you demote/kick an *account*, not a
-- human. A person owns several accounts (main + alts); aggregating their strikes across accounts was
-- wrong — two strikes on a main plus two on an alt read as a false removal-flagged red, and a strike
-- on a benched alt wrongly benched the person's clean CWL account. The subject/grouping unit moves
-- from person_id -> player_account_tag. person_id STAYS on every strike (profile link, Discord
-- @mention, person-based note authorship); it is just no longer the grouping key.
--
-- Derivation (active count, colour, war-eligibility, removal-at-3) is unchanged — it already runs on
-- whatever strike list it is handed (src/lib/strikes/status.ts); only the grouping in dossier.ts /
-- plan.ts / commit.ts / cwl roster+allocation changed. This migration realigns the stored data.

-- 1. Backfill any strike missing an account tag from the person's main account (else highest-added),
--    so every strike has a subject account to group under. Manual/auto strikes already carry a tag;
--    this only catches legacy/edge rows.
UPDATE strikes s SET player_account_tag = (
    SELECT pa.player_tag FROM player_accounts pa
    WHERE pa.person_id = s.person_id
    ORDER BY pa.is_main_account DESC, pa.added_at ASC
    LIMIT 1
)
WHERE s.player_account_tag IS NULL;

-- 2. Re-key non-legacy strikes from `${source}:${round}:${personId}` to account-based
--    `${source}:${round}:${tag}`, matching the new strikeKeyFor()/commitReviewStrike() so a future
--    re-scan folds into the SAME strike row instead of creating a duplicate. Legacy warning imports
--    (`legacy_warning:*`) and keyless manual strikes are left untouched. Two accounts of the same
--    person are never in one war, so this can't collide.
UPDATE strikes
SET strike_key = war_source || ':' || war_round_id::text || ':' || player_account_tag
WHERE strike_key IS NOT NULL
  AND strike_key NOT LIKE 'legacy_%'
  AND war_round_id IS NOT NULL
  AND player_account_tag IS NOT NULL;

-- 3. Index the new grouping key (per-account dossier queries + war-eligibility loads filter on it).
CREATE INDEX IF NOT EXISTS idx_strikes_account ON strikes(player_account_tag);
