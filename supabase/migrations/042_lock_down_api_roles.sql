-- Lock the public API roles out of the database.
--
-- Until now the app read and wrote with the public anon key, which also shipped in the browser
-- bundle — so anyone holding it could read or rewrite any table directly through PostgREST,
-- skipping every check in auth-server.ts. The app now talks to the database only from API routes,
-- with the secret (service_role) key, so `anon` and `authenticated` need nothing at all.
--
-- MERGE ONLY AFTER production runs on SUPABASE_SERVICE_ROLE_KEY: a deploy still falling back to
-- the anon key loses all database access the moment this applies.
--
-- Two layers, either of which is enough on its own:
--   1. Privileges are revoked, so PostgREST refuses the request before it reaches a row.
--   2. RLS is enabled with no policies, which denies every row to any role that does not bypass
--      RLS — so a grant re-added later by mistake (a copied migration line) still exposes nothing.
-- service_role bypasses RLS and keeps its grants, so the app is unaffected.

-- 1. Revoke everything the API roles hold now.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM anon, authenticated, PUBLIC;

-- …and stop future objects (created by migrations, which run as postgres) from granting them.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES  FROM anon, authenticated, PUBLIC;

-- The app's own role keeps full access, now and for future objects.
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES  TO service_role;

-- 2. RLS on every existing table, no policies: deny-all for anything but service_role.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
