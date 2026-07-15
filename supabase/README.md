# Database migrations

Migrations live in `supabase/migrations/` as `NNN_name.sql`, applied to the **production**
Supabase project (`mhgitoarcdakjdnzapsx`) by the Supabase CLI.

## How it works now

Merging a new `supabase/migrations/*.sql` file to `main` triggers
`.github/workflows/db-migrate.yml`, which runs `supabase db push`. That applies **only**
migrations not yet recorded in the remote migration-history table, so it is safe on every
merge. No more hand-running SQL in the dashboard.

## Adding a migration

```bash
supabase migration new short_description     # creates supabase/migrations/<timestamp>_short_description.sql
# edit the file, commit it in a PR
```

On merge to `main`, the workflow applies it. To apply locally / verify first:

```bash
supabase db push            # against the linked (prod) project — or use --db-url for a specific DB
```

## ⚠️ One-time setup (do this ONCE before merging this branch)

The 12 existing migrations (`001`–`012`) were already applied to prod **by hand**, but the
CLI's migration-history table is empty. Without baselining, the first `supabase db push`
would try to replay all 12 and fail on objects that already exist. Baseline them first
(needs the DB password — Project → Settings → Database):

```bash
# 1. Generate supabase/config.toml for your CLI version (keeps migrations/ intact) and commit it
supabase init

# 2. Link to prod
supabase link --project-ref mhgitoarcdakjdnzapsx

# 3. Mark all pre-existing migrations as ALREADY applied (does NOT run them)
supabase migration repair --status applied \
  001 002 003 004 005 006 007 008 009 010 011 012

# 4. Verify: every migration shows applied on both Local and Remote, nothing pending
supabase migration list
```

Commit the generated `supabase/config.toml`. After this, `supabase db push` (and the CI
workflow) will only ever apply *future* migrations.

> If `migration repair` rejects the short `001` versions, rename the files to the CLI's
> `<timestamp>_name.sql` form and repair with those versions instead.

## Required GitHub secrets

Settings → Secrets and variables → Actions:

- `SUPABASE_ACCESS_TOKEN` — a personal access token (Supabase account → Access Tokens)
- `SUPABASE_DB_PASSWORD` — the production database password

The project ref is not secret and lives in the workflow.

## Grants

A normal Supabase project auto-grants new `public` tables to the API roles, so migrations
need no `GRANT`. (The separate `npm run db:grant` exists only for the free **testing**
project, which was provisioned without those default privileges.)
