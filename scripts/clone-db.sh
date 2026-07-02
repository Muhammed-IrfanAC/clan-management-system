#!/usr/bin/env bash
#
# Copies the `public` schema (structure + data + RLS policies) from the
# production Supabase project into the testing project.
#
# Reads SRC_DB_URL and DST_DB_URL from .env.testing. Safe to re-run: the dump
# uses --clean --if-exists, so it drops and recreates the public objects in the
# target each time. Reads from source, writes ONLY to target.
#
# Usage:  npm run db:clone
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env.testing ]]; then
  echo "Missing .env.testing (holds SRC_DB_URL and DST_DB_URL)." >&2
  exit 1
fi
set -a; source .env.testing; set +a

: "${SRC_DB_URL:?Set SRC_DB_URL in .env.testing}"
: "${DST_DB_URL:?Set DST_DB_URL in .env.testing}"

# Supabase runs PostgreSQL 17, so we need a v17+ client. Prefer the Homebrew
# postgresql@17 keg (kept unlinked) over whatever is on PATH.
PG_BIN="/opt/homebrew/opt/postgresql@17/bin"
if [[ -x "$PG_BIN/pg_dump" ]]; then
  PATH="$PG_BIN:$PATH"
fi

DUMP_FILE="$(mktemp -t coc_dump.XXXXXX).sql"
trap 'rm -f "$DUMP_FILE"' EXIT

echo "→ Dumping public schema from source project…"
pg_dump "$SRC_DB_URL" \
  --schema=public \
  --no-owner --no-privileges \
  --clean --if-exists \
  -f "$DUMP_FILE"

echo "→ Restoring into testing project…"
psql "$DST_DB_URL" -v ON_ERROR_STOP=1 -f "$DUMP_FILE"

# The dump is taken with --no-privileges (avoids role-ownership noise), so the
# Supabase API roles lose their grants on the recreated tables. Without this,
# the anon/service keys can't read anything and every PostgREST query returns
# empty. Re-grant to match a fresh Supabase project's defaults.
echo "→ Re-granting privileges to Supabase API roles…"
psql "$DST_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
SQL

echo "✓ Testing DB now mirrors production's public schema + data."
