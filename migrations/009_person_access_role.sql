-- RBAC v2: permission moves from the ACCOUNT to the PERSON.
--
-- Rationale: db_role and access_enabled on player_accounts were doing two jobs at once —
-- mirroring the in-game clan rank AND storing the granted dashboard permission. Sync could
-- never freely write the live rank without clobbering someone's RBAC role (the "Role Protection
-- Rule" in sync.ts). Splitting them:
--   * player_accounts.db_role  -> stays, but becomes a PURE clan-status mirror (synced every pass).
--   * persons.access_role      -> NEW: the single source of truth for dashboard permission.
--                                 NULL = no access. Because it lives on the person, every linked
--                                 alt inherits it automatically — grant once, revoke once.
--
-- Run this manually in Supabase (migrations are not auto-applied).

-- 1. The permission enum. Kept to the three dashboard tiers so it is easy to set by hand in the DB.
--    'super_admin' stays single-owner; elevation to leader/super_admin remains a deliberate
--    Settings-or-DB action (see permissions.ts assignableRoles).
DO $$ BEGIN
  CREATE TYPE access_role AS ENUM ('super_admin', 'leader', 'co_leader');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. The column. Nullable: NULL = no dashboard access. "Who can log in?" == access_role IS NOT NULL.
ALTER TABLE persons ADD COLUMN IF NOT EXISTS access_role access_role;

-- 3. Backfill from the current account-level state. A person may own several accounts; take the
--    HIGHEST role among their enabled accounts (super_admin > leader > co_leader) so no one is
--    accidentally demoted by an alt sitting on a lower role.
UPDATE persons p
SET access_role = ranked.role
FROM (
  SELECT person_id,
         (ARRAY_AGG(db_role ORDER BY
            CASE db_role
              WHEN 'super_admin' THEN 0
              WHEN 'leader'      THEN 1
              WHEN 'co_leader'   THEN 2
              ELSE 3
            END))[1]::access_role AS role
  FROM player_accounts
  WHERE access_enabled = TRUE
    AND db_role IN ('super_admin', 'leader', 'co_leader')
    AND person_id IS NOT NULL
  GROUP BY person_id
) AS ranked
WHERE p.id = ranked.person_id;

-- 4. Drop the now-redundant account-level access flag. db_role is intentionally kept (clan status).
ALTER TABLE player_accounts DROP COLUMN IF EXISTS access_enabled;
