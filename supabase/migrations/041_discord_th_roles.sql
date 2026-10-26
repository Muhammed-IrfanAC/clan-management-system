-- Town-hall roles on the family Discord (lib/members/thRoleSync.ts).
--
-- `discord_th_roles` is the bot's memory of which guild role stands for each town hall level — the
-- roles it created, or adopted because a role of that name already existed. Keyed by level and
-- holding the role ID rather than matching by name each time, so a leader renaming or recolouring
-- a role does not make the bot create a second one. These rows are also the boundary of what the
-- bot touches: it adds and removes only roles listed here, never anything else on a member.
--
-- `discord_th_role_sync` is a single row recording when a pass last FINISHED (the daily gate) and a
-- claim stamp so two overlapping syncs — the cron and a dashboard sync — cannot both create TH19.
-- A pass cut short by its time budget leaves `completed_at` alone, so the next sync carries on.

CREATE TABLE IF NOT EXISTS discord_th_roles (
  th_level INT PRIMARY KEY,
  role_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS discord_th_role_sync (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  completed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT 'epoch'
);

INSERT INTO discord_th_role_sync (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- Explicit, because newer Supabase stacks no longer auto-grant new public tables to the API roles,
-- and the app talks to the database with the anon key.
GRANT SELECT, INSERT, UPDATE, DELETE ON discord_th_roles TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON discord_th_role_sync TO anon, authenticated, service_role;
