-- Migration 008: RBAC baseline.
--
-- Role-based access control is now ENFORCED (see src/lib/permissions.ts). db_role has, until now,
-- been stored but never checked, so historical values are unreliable. This resets every account
-- with dashboard access to the co_leader floor. The owner then elevates the top tiers by hand:
-- super_admin is intentionally DB-only (single owner), and leaders are designated below.
--
-- Non-dashboard accounts (access_enabled = false) are left untouched — their role is inert.

UPDATE player_accounts
SET db_role = 'co_leader'
WHERE access_enabled = true;

-- Bootstrap the owner and leaders manually after running the above, e.g.:
--   UPDATE player_accounts SET db_role = 'super_admin' WHERE player_tag = '#YOUR_OWNER_TAG';
--   UPDATE player_accounts SET db_role = 'leader'      WHERE player_tag IN ('#TAG_A', '#TAG_B');
