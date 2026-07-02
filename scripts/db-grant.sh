#!/usr/bin/env bash
#
# Grants the Supabase API roles (anon / authenticated / service_role) access to
# the public schema on the TESTING project, and configures DEFAULT PRIVILEGES so
# that any table/sequence/function created *in the future* is auto-granted too.
#
# Why this is needed: a normal Supabase project ships with these default
# privileges, but the free testing project was provisioned without them — so a
# freshly created table is invisible to the anon key (PostgREST returns
# "permission denied for table ..."). Run this once and future tables just work;
# re-run it any time a "permission denied" surprises you.
#
# Idempotent. Reads DST_DB_URL from .env.testing.
#
# Usage:  npm run db:grant
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f .env.testing ]] || { echo "Missing .env.testing" >&2; exit 1; }
set -a; source .env.testing; set +a
: "${DST_DB_URL:?Set DST_DB_URL in .env.testing}"

PG_BIN="/opt/homebrew/opt/postgresql@17/bin"
[[ -x "$PG_BIN/psql" ]] && PATH="$PG_BIN:$PATH"

psql "$DST_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
-- Existing objects
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO anon, authenticated, service_role;

-- Future objects created by the postgres role (SQL editor & migrations run as postgres)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL     ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL     ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON ROUTINES  TO anon, authenticated, service_role;
SQL

echo "✓ Grants applied and default privileges set on the testing DB."
