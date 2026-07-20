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

Tests are Node-environment unit tests over the **pure** modules only — there is no DB/DOM test harness. Current suites cover `cwl/` (allocation, rotation, performance, history), `strikes/` (status, plan, dossier, mutations), and `rules/` (warContext, automationScope). If you add a pure module, add a `*.test.ts` beside it.

## Architecture

ClanOps is a Clash of Clans clan-family management dashboard: Next.js 16 App Router + React 19, Supabase (PostgreSQL) for storage, and the official CoC API (via a proxy) for live game data. UI is vanilla CSS (`src/app/globals.css`) + Tailwind v4 + Lucide icons — no component library.

### Client state: Zustand stores + component split
Newer dashboard pages follow one convention — a per-feature Zustand store under `src/lib/stores/` is the single source of truth, and the page is split into small feature components under `src/components/<domain>/`:

- Stores: `strikeStore`, `memberDossierStore`, `activityStore`, `settingsStore`, `membersStore`. State = server truth (fetched from API routes) + transient UI flags (per-action in-flight guards like `savingStrikeId`, `postingNote`; a shared `toast`).
- Mutations apply **granular, ID-keyed splices** of the changed row rather than a full refetch, so only the affected card re-renders (no whole-page flash). The API route returns the updated row; the store merges it.
- The `page.tsx` is a thin `'use client'` orchestrator (tabs, modals, mount-time load). Feature sub-components (e.g. `components/settings/RulesTab.tsx`, `components/activity/ActivityCard.tsx`) call `useStore()` directly — they do **not** receive data via props.
- Pages on this pattern: `/dashboard/{strikes,members,members/[id],activity,settings}`. Older pages (`/dashboard/cwl`, `/dashboard/warnings`) predate it.

### Auth & authorization (read this before touching any API route)
Identity and permission are deliberately separated across two DB columns — see `src/lib/auth-server.ts` and `src/lib/permissions.ts`:

- **Login is tag-based, no passwords.** `POST /api/auth/login` takes a CoC player tag; a signed JWT is set as the `clanops-auth` httpOnly cookie. `src/middleware.ts` guards `/dashboard/*` and gives a 30-day sliding session.
- **Identity** = `player_accounts.player_tag` (one global row per tag). **Permission** = `persons.access_role` (`super_admin` | `leader` | `co_leader` | NULL). Access lives on the **person**, so every linked alt inherits it and revoking it blocks all alts. `player_accounts.db_role` is a *clan-rank mirror only* (synced from in-game rank) and is **never** used for authorization.
- The JWT's role is a stale hint. Every mutation must re-check the **live** DB role: call `authorizeActive(request)` (returns `{ actorTag, role } | { error }`) or `requireCapability(auth, cap)`. This closes the "revoked mid-session" gap. Never gate on the cookie's role alone. Use `hasCapability(tag, cap)` for non-throwing probes that widen author-only checks (e.g. `content.override`).
- Authorization is a **capability model**, not scattered `if (role === ...)`. The pure `permissions.ts` defines the `Capability` union (`content.override`, `clan.create`, `account.delete`, `leader.manage`, `rules.delete`, `role.assign_any`, `role.assign_coleader`), the coded per-role defaults (`ROLE_CAPS`), and `can()` / `assignableRoles()` / `canAssignRole()`. Both API routes (the real enforcement boundary) and UI (button visibility) import the same pure `can()`.
- **Co-leader capabilities are runtime-configurable.** The `role_capabilities` table (migration 022) holds explicit per-`(role, capability)` overrides that win over `ROLE_CAPS`; only `co_leader` is editable, and only for the `CONFIGURABLE_CO_LEADER_CAPS` whitelist (excludes `role.assign_any`, keeping a single-owner model). `permissions-server.ts` loads overrides with a 15s cache; `/api/permissions` (super_admin only) toggles them and invalidates the cache. Always thread the loaded overrides into `can()` — the auth-server helpers do this for you.

### Data access
`src/lib/supabase.ts` exports a single client built with the **anon key, used server-side**. The app does **not** rely on RLS for auth — every API route enforces auth in code via `auth-server.ts`. Routes use PostgREST embeds (e.g. `person:persons(access_role)`, `violations:strike_violations(*)`) heavily.

### Domain modules (`src/lib/`)
Business logic lives in `lib/`, kept free of React/JSX so sync jobs, API routes, and tests can all import it:

- **`sync.ts`** — reconciles each clan's roster against the CoC API. Accounts are resolved **globally by `player_tag`** (not per-clan) so players moving between family clans keep their person link, role, and access.
- **`babies.ts`** — the "baby" (new-recruit trial) lifecycle: trial window, auto-graduation on in-game promotion, expiry sweeps. Never auto-deletes a person holding `access_role`.
- **`onboarding.ts` / `queues.ts`** — structured onboarding. A member's stage is **derived** from an append-only `onboarding_events` log (single source of truth; nothing cached on the person). `queues.ts` turns that into a prioritized leader worklist.
- **`cwl/`** — Clan War League. `allocation.ts` is the highest-risk piece: a **pure, deterministic, unit-tested** roster engine (no I/O) — feed it eligible players + clans + frozen constraints, get one allocation per person. `live.ts` syncs live rounds; `rotation.ts` / `performance.ts` / `history.ts` derive suggestions and stats. `coc-api.ts`'s `fetchFromCoCOptional` treats CWL 404s as the normal off-season empty state. Allocation excludes accounts that are war-ineligible from active strikes.
- **`war.ts` / `warAttacks.ts`** — regular (non-CWL) war ingestion. `war.ts` polls each active clan's current war into `war_rounds`; `warAttacks.ts` persists per-attack detail (shared by regular wars → `war_attacks` and CWL → `cwl_war_attacks`) with `ON CONFLICT DO NOTHING`, which preserves the **first-sighting** `first_seen_at`/`first_seen_state` an attack was polled at — that immutable timestamp is what late-snipe timing relies on. Both are I/O modules.
- **`rules/`** — automated war-rule violation detection. The split mirrors cwl's pure/impure discipline: `warContext.ts` and `automationScope.ts` are **pure and unit-tested** (attack reconstruction + hit-up/late-snipe judgement; per-clan scope filter). `registry.ts` is UI-safe detector metadata (no server imports). The DB/orchestration half is `scan.ts` (runs enabled detectors, applies each clan's scope, commits) plus `detectors/` (`missedAttack`, `hitUp`, `lateSnipe` wrappers + `warContextLoad`). Built-in detectors: `war_missed_attack` (auto), `war_late_snipe` (auto), `war_unjustified_hitup` (review-mode → queues a suggestion instead of auto-striking). Leadership is exempt via `persons.access_role` (never in-game `db_role`). Per-clan `rule_automation_mode` (`always` | `cwl_only` | `never`, migration 018) gates which war types automate, enforced uniformly in `scan.ts`.
- **`strikes/`** — the discipline system that supersedes the legacy `warnings/` tables (warnings routes/UI still exist but are sunset). Same three-phase pure shape as allocation: `status.ts` derives active count / level / war-eligibility from a strike list (a strike is **active only within a rolling 90-day window** — expiry is *derived* from `issued_at`, there is no `expires_at` column, migration 020); `plan.ts` groups violations into stable one-strike-per-`(account, war)` containers; `dossier.ts` + `mutations.ts` build the leadership worklist and status transitions. `commit.ts` and `notify-context.ts` are the DB/notify half. Strikes are scoped **per account** (`player_account_tag`), not per person, so each alt is judged independently while staying linked for notifications/profile. Auto detectors commit strikes directly; `war_unjustified_hitup` queues to `strike_suggestions` and a leader confirms via `/api/rules/review/[id]`, which **folds** the violation into that war's existing strike (never a second strike). Trust-restoration is a checklist + a leader `leadership_approved` flag that clears the demotion intent but never removes the strike from the active count.
- **`discord.ts`** — best-effort webhook notifications (migration 013). Posts warning/strike embeds to the per-clan `clans.discord_webhook_url` (falling back to a global `DISCORD_WEBHOOK_URL`), optionally @-mentioning the member via their linked `discord_user_id`. Every send is fail-safe: a missing URL is a silent no-op and a non-2xx is swallowed, so a Discord failure never fails the strike write.
- **`contribution.ts`** — pure leadership-recognition metrics aggregated from onboarding events and recruitment logs (activity credited to the actor, outcomes to the recruiter).
- **`permissions.ts` / `permissions-server.ts`** — see Auth above. **`ClanContext.tsx` / `useCurrentUser.ts`** are the two client-side data hooks (selected-clan context; live `/api/auth/me` user + capabilities).

### API & sync
Routes live under `src/app/api/**/route.ts`. `POST /api/sync` (optional `clanId`, else all active clans) is the workhorse: it reconciles rosters, expires departed babies, ingests regular + CWL wars, runs rule detectors, and best-effort refreshes CWL live state (CWL failures are swallowed so they never fail the roster sync). Sync is triggered by authenticated dashboard requests **and** by `POST /api/cron/sync` — a machine-auth endpoint for external schedulers that authenticates via a `Bearer $CRON_SECRET` header (constant-time compare, disabled when the env var is unset) rather than the JWT cookie. Notable lifecycle routes: `DELETE /api/persons/[id]` (removes a person, detaching accounts back to Unlinked; requires `leader.manage` and rejects a person who still holds access), and account link/unlink via `/api/members/link` (auth-enforced through `authorizeActive`).

### Database migrations
Base schema is `supabase_setup.sql`. Incremental changes are numbered SQL files in `supabase/migrations/` (e.g. `010_cwl_schema.sql`). On merge to `main`, `.github/workflows/db-migrate.yml` runs `supabase db push` to apply any not-yet-recorded migrations to the **production** project — do **not** hand-run prod SQL anymore (that drift is what this replaces). Add one with `supabase migration new <name>`; see `supabase/README.md` for the flow and the one-time baseline of `001`–`012` (the series continues past `022_role_capabilities`). For the **testing** project, run `npm run db:grant` if the anon key hits "permission denied" after adding a table.

### Environment
`.env.local` (dev/prod) and `.env.testing` hold: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `JWT_SECRET`, `COC_API_TOKEN`, optional `COC_API_PROXY_URL` (recommended — the CoC API requires IP allowlisting, so a fixed-IP proxy is used), optional `CRON_SECRET` (bearer token for `/api/cron/sync`), optional `DISCORD_WEBHOOK_URL` (global fallback for Discord notifications), and optional `RULES_FRESH_START` (an ISO date; the war-rule detectors never scan or strike any war that ended before it — set it to the reset moment when starting a clean strike system so previously-ended wars stay invisible even after their strikes are wiped).
