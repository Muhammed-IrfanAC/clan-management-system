# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev            # Next.js dev server (uses .env.local)
npm run dev:testing    # dev server against the testing DB (.env.testing)
npm run build          # production build (also typechecks — there is no separate typecheck script)
npm run lint           # eslint
npm run test           # vitest run (all *.test.ts)
npx vitest run src/lib/cwl/allocation.test.ts   # single test file
npx vitest run -t "name"                         # single test by name
npm run db:clone       # copy prod public schema+data into the testing project (scripts/clone-db.sh)
npm run db:grant       # (re)grant Supabase API roles on the testing project (scripts/db-grant.sh)
```

Tests are Node-environment unit tests over the **pure** modules only (allocation, rotation, performance, history) — there is no DB/DOM test harness.

## Architecture

ClanOps is a Clash of Clans clan-family management dashboard: Next.js 16 App Router + React 19, Supabase (PostgreSQL) for storage, and the official CoC API (via a proxy) for live game data. UI is vanilla CSS (`src/app/globals.css`) + Tailwind v4 + Lucide icons — no component library.

### Auth & authorization (read this before touching any API route)
Identity and permission are deliberately separated across two DB columns — see `src/lib/auth-server.ts` and `src/lib/permissions.ts`:

- **Login is tag-based, no passwords.** `POST /api/auth/login` takes a CoC player tag; a signed JWT is set as the `clanops-auth` httpOnly cookie. `src/middleware.ts` guards `/dashboard/*` and gives a 30-day sliding session.
- **Identity** = `player_accounts.player_tag` (one global row per tag). **Permission** = `persons.access_role` (`super_admin` | `leader` | `co_leader` | NULL). Access lives on the **person**, so every linked alt inherits it and revoking it blocks all alts. `player_accounts.db_role` is a *clan-rank mirror only* (synced from in-game rank) and is **never** used for authorization.
- The JWT's role is a stale hint. Every mutation must re-check the **live** DB role: call `authorizeActive(request)` (returns `{ actorTag, role } | { error }`) or `requireCapability`. This closes the "revoked mid-session" gap. Never gate on the cookie's role alone.
- Authorization is a **capability model**, not scattered `if (role === ...)`. Add a feature by granting a `Capability` in `permissions.ts`; both API routes (the real enforcement boundary) and UI (button visibility) import the same pure `can()`.

### Data access
`src/lib/supabase.ts` exports a single client built with the **anon key, used server-side**. The app does **not** rely on RLS for auth — every API route enforces auth in code via `auth-server.ts`. Routes use PostgREST embeds (e.g. `person:persons(access_role)`, `warning_notes(*)`) heavily.

### Domain modules (`src/lib/`)
Business logic lives in `lib/`, kept free of React/JSX so sync jobs, API routes, and tests can all import it:

- **`sync.ts`** — reconciles each clan's roster against the CoC API. Accounts are resolved **globally by `player_tag`** (not per-clan) so players moving between family clans keep their person link, role, and access.
- **`babies.ts`** — the "baby" (new-recruit trial) lifecycle: trial window, auto-graduation on in-game promotion, expiry sweeps. Never auto-deletes a person holding `access_role`.
- **`onboarding.ts` / `queues.ts`** — structured onboarding. A member's stage is **derived** from an append-only `onboarding_events` log (single source of truth; nothing cached on the person). `queues.ts` turns that into a prioritized leader worklist.
- **`cwl/`** — Clan War League. `allocation.ts` is the highest-risk piece: a **pure, deterministic, unit-tested** roster engine (no I/O) — feed it eligible players + clans + frozen constraints, get one allocation per person. `live.ts` syncs live rounds; `rotation.ts` / `performance.ts` / `history.ts` derive suggestions and stats. `coc-api.ts`'s `fetchFromCoCOptional` treats CWL 404s as the normal off-season empty state.

### API & sync
Routes live under `src/app/api/**/route.ts`. `POST /api/sync` (optional `clanId`, else all active clans) is the workhorse: it reconciles rosters, expires departed babies, and best-effort refreshes CWL live state (CWL failures are swallowed so they never fail the roster sync). Sync is triggered by authenticated dashboard requests, not a built-in cron.

### Database migrations
Base schema is `supabase_setup.sql`. Incremental changes are numbered SQL files in `supabase/migrations/` (e.g. `010_cwl_schema.sql`). On merge to `main`, `.github/workflows/db-migrate.yml` runs `supabase db push` to apply any not-yet-recorded migrations to the **production** project — do **not** hand-run prod SQL anymore (that drift is what this replaces). Add one with `supabase migration new <name>`; see `supabase/README.md` for the flow and the one-time baseline of `001`–`012`. For the **testing** project, run `npm run db:grant` if the anon key hits "permission denied" after adding a table.

### Environment
`.env.local` (dev/prod) and `.env.testing` hold: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `JWT_SECRET`, `COC_API_TOKEN`, and optional `COC_API_PROXY_URL` (recommended — the CoC API requires IP allowlisting, so a fixed-IP proxy is used).
