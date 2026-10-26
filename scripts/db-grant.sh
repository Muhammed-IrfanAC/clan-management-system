#!/usr/bin/env bash
#
# Grants the app's role (service_role — the secret key) access to the public
# schema on the TESTING project, and configures DEFAULT PRIVILEGES so that any
# table/sequence/function created *in the future* is auto-granted too.
#
# The public API roles (anon / authenticated) get nothing, matching production
# since migration 042: the browser never talks to the database, so a grant to
# them only exposes data to anyone holding the publishable key. This also
# revokes anything they still hold from before. Re-run it any time a
# "permission denied" surprises you.
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
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON ALL TABLES    IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO service_role;
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM anon, authenticated, PUBLIC;

-- Future objects created by the postgres role (SQL editor & migrations run as postgres)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL     ON TABLES    TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL     ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON ROUTINES  TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES  FROM anon, authenticated, PUBLIC;
SQL

echo "✓ Grants applied and default privileges set on the testing DB."
