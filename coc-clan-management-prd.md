# Product Requirements Document
## CoC Clan Management System ("ClanOps")

**Version:** 0.4  
**Status:** For review  
**Last updated:** June 17, 2026  
**Changes from v0.3:** Capital Radar module removed — automated detection not viable due to API timing constraints and algorithm coverage gaps. Capital rule migrated to manual Warning path via Rule Library. Cron slots freed up for sync only. Settings table cleaned of all capital-detection keys.

---

## 1. Overview

### 1.1 Problem Statement

Running a competitive Clash of Clans clan involves dozens of moving parts that currently live nowhere — notes apps, memory, or unstructured in-game chat. There's no single place to:

- Know who all the alt accounts of a member are
- Track whether a rule was broken and if it was acknowledged
- Log leadership decisions or activity over time
- Onboard new members without manual effort

The target user is **clan leadership only** (Leader + Co-Leaders). Regular members are not expected to access the system at all — they're scoped to in-game chat.

### 1.2 Goals

- Give leadership a centralized web dashboard to manage a **clan family** (up to 3 clans, scalable)
- Zero reliance on personal data (no email, no phone, no Discord)
- Authenticate using only what leaders already have: their player tag
- Auto-sync member roster (Elder/Member) via the CoC API without affecting leadership access
- All dynamic values and behaviours configurable from a Settings page — minimal hardcoding

### 1.3 Non-Goals

- Member-facing interface or notifications
- In-game automation (CoC API is read-only)
- Automated Capital sandbagging detection (see Section 6.3 for rationale and manual path)
- Discord integration
- Mobile-native app (responsive web only)

---

## 2. CoC API Capabilities

Base URL: `https://api.clashofclans.com/v1`  
Auth: Bearer token (pre-registered and provided externally — not managed by this system)

| Endpoint | What we get |
|---|---|
| `GET /clans/{clanTag}` | Clan info + full member list (roles, TH levels, trophies, donations) |
| `GET /players/{playerTag}` | Player profile: name, tag, clan, role, TH level, league, heroes |
| `GET /clans/{clanTag}/members` | Member list, paginated |
| `GET /clans/{clanTag}/warlog` | Past war results |
| `GET /clans/{clanTag}/currentwar` | Live war state |
| `GET /clans/{clanTag}/currentwar/leaguegroup` | CWL info |

**API key constraint:** Keys are IP-locked. Vercel serverless has no stable IP. Mitigation: proxy all CoC API calls through a small, static-IP VPS (~$4/month Hetzner). This is the only real cost in the stack.

---

## 3. Settings-First Architecture

> *"Every dynamic value should be configurable from Settings — minimal hardcoding."*

A `settings` table in the DB stores key-value pairs, editable by the Super Admin from the Settings page. Application code reads these at runtime. New settings can be added without code changes — just a new row.

**Settings categories:**

| Category | Examples |
|---|---|
| Sync | Interval (minutes), auto-sync enabled |
| Warnings | HIGH escalation period (days) |
| Access | Cross-clan warning visibility |
| Clans | Display order, display aliases |

**Design rule:** Any value that leadership might reasonably want to change over time lives in Settings, not in code.

---

## 4. Authentication & Role Design

### 4.1 Core Principle

No email. No password. Identity = player tag. Access is governed by a DB role table — not the live CoC API — so sync events never revoke a leader's dashboard access.

### 4.2 Two-Layer Auth Model

**Layer 1 — First onboarding:**
```
User enters player tag
→ Server calls GET /players/{tag} via CoC API
→ If tag is in any family clan AND in-game role = leader/coLeader
  → Check DB leadership table
    → Tag already exists → grant access per DB role
    → Tag not in DB → create leadership entry, grant access
→ Else → deny
```

**Layer 2 — Returning user:**
```
User enters player tag
→ Server checks DB leadership table
→ Found AND access_enabled = true → grant access (no CoC API call needed)
→ Not found → fall back to Layer 1
```

Once a leader is in the DB, their access is entirely DB-governed. Fast, reliable, immune to sync.

### 4.3 Super Admin

One player tag, seeded at setup. Cannot be removed via the UI — only via direct DB edit.

**Super Admin exclusive powers:**
- Add/remove leaders from the leadership table
- Enable/disable any leader's access
- Change all Settings values
- Cannot be locked out by any other user action

### 4.4 Access Levels

| DB Role | Who assigns | Dashboard access |
|---|---|---|
| `super_admin` | Seeded at setup | Everything + Settings + leadership management |
| `leader` | Super Admin | Full dashboard |
| `co_leader` | Super Admin | Full dashboard |
| `elder` *(v3)* | Super Admin | Read-only |

### 4.5 Sync Protection Rule

**Sync never writes to the leadership table.** It never modifies `db_role` or `access_enabled` for any user. It only updates cosmetic fields on `PlayerAccount` (name, TH level, trophies, donations) for elder/member-tier accounts.

If a co-leader is temporarily demoted in-game (e.g., during CWL rotation), their DB entry stays `co_leader`. The Super Admin is the only one who changes that.

---

## 5. Clan Family

### 5.1 Scope

Three clans at launch. Architecture is row-based — adding a fourth is a data operation, not a code change.

### 5.2 Clan Data Model

```
Clan
  └── id (PK)
  └── clan_tag (unique, from CoC)
  └── display_name (e.g., "Main", "Feeder 1", "Feeder 2")
  └── clan_type (enum: main / feeder)
  └── display_order (int)
  └── active (bool — disable without deleting)
  └── created_at
```

### 5.3 Cross-Clan Rules

- Every `PlayerAccount` belongs to one `Clan`
- A `Person` (the human) can have accounts across multiple clans
- Warnings are on `Person` — they follow the person across clans
- Cross-clan warning visibility is a Setting: if enabled, all leaders see all warnings across the family regardless of which clan the person is in
- Moving a member from feeder → main updates `PlayerAccount.clan_id`; history stays intact

---

## 6. Core Modules

### Module 1: Member Registry

Tracks all accounts (mains + alts) per human, across all clans.

**Data model:**

```
Person
  └── id (PK)
  └── display_name (set by leader — their known name across the family)
  └── notes (free text)
  └── created_at

PlayerAccount
  └── player_tag (PK, from CoC API)
  └── person_id (FK → Person, nullable until linked)
  └── clan_id (FK → Clan)
  └── is_main_account (bool)
  └── db_role (enum: leader / co_leader / elder / member)
  └── access_enabled (bool — only relevant for leader/co_leader)
  └── status (enum: active / left / removed)
  └── added_at
  └── [synced, non-leaders only]: in_game_name, th_level, trophies, league,
                                   donations, donations_received
  └── last_synced_at
```

**Key behaviors:**
- New tag in CoC roster → auto-create unlinked `PlayerAccount`, flag for leadership review
- Tag leaves roster → set `status: left`, history preserved
- Leadership `db_role` seeded from CoC API on first onboarding, never overwritten by sync
- Alts linked to same `Person` manually by leaders
- Search by: in-game name, display name, tag, clan

**UI views:**
- Member list: filterable by clan or "All Clans"; rows expandable to show all accounts per person
- Per-person profile: all accounts (with clan badge), warning history, notes
- Unlinked accounts panel: per-clan queue of new arrivals needing assignment

---

### Module 2: Warning System

**Single severity: Warning.** No tiers, no strike system.

**Auto-escalation to HIGH:** A warning unacknowledged beyond `warning_escalation_days` (default: 3, configurable in Settings) is displayed as HIGH. This is computed at query time — never stored separately.

**Data model:**

```
Warning
  └── id (PK)
  └── person_id (FK → Person)
  └── player_account_tag (FK → PlayerAccount — the specific account involved)
  └── rule_id (FK → Rule, optional)
  └── description (free text)
  └── logged_by (player_tag of the leader who logged it)
  └── logged_at
  └── acknowledged (bool)
  └── acknowledged_at
  └── notes (leader can add context after the fact)

Rule (rule library — editable in Settings)
  └── id (PK)
  └── name
  └── description
  └── logging_guidance (optional — tips for leaders on what to record when logging this rule)
```

**Computed at query time:**
```
is_high = (acknowledged = false)
          AND (NOW() - logged_at > settings.warning_escalation_days)
```

**Key behaviors:**
- Every warning shows: Person name + which PlayerAccount + description + who logged it + when
- Acknowledged = leader has told the member in-game, marks it done here
- Cross-clan visibility: controlled by Settings — if enabled, all leaders see all warnings across the family

**UI views:**
- Warning log: sortable, filterable by pending / HIGH / person / clan / rule / date
- Per-person profile: warning history inline, PlayerAccount shown per entry
- Dashboard home: HIGH count (red), pending count (yellow)

---

### Module 3: Rule Library

A curated list of rules that leaders select from when logging a Warning. Editable by Super Admin from Settings. Not a rigid enum — it's a living reference that grows with the clan.

Each rule can carry `logging_guidance` — a short note visible to leaders when they select it, reminding them what context to capture. This is especially important for rules where the evidence is time-sensitive.

**Seeded rules at launch:**

| Rule name | Description | Logging guidance |
|---|---|---|
| Miss war attack | Did not use one or both war attacks | Note which war, which attack number missed |
| Deliberate capital sandbagging | Left a district unfinished and moved to another while having attacks remaining | **Log during the raid weekend — evidence is not accessible after it ends. Note the district name, approximate % left, and what they switched to.** |
| Donation abuse | Repeatedly requesting without donating | Note donation ratio at time of log |
| Inactivity | Extended period without attacks or donations | Note last active date |
| Disrespectful conduct | Behaviour violating clan conduct rules | Note what was said/done and where |

**Why the capital rule lives here and not in automation:**

The sandbagging behaviour cannot be reliably detected post-weekend via the API — the game removes access to the raided clan's layout once the weekend ends, meaning leaders lose the ability to verify or demonstrate the violation to the member. The varying scenarios (weak army, slow deployment, cherry-picking easy districts) are also hard to cover algorithmically without high false-positive rates.

The correct enforcement path is **real-time observation by a leader during the raid weekend**. When a leader sees it happen, they log a Warning immediately — selecting the Capital Sandbagging rule, noting the district and context in the description. The `logging_guidance` field surfaces this reminder at the point of logging.

This keeps the system honest: a Warning has a leader behind it, not just an algorithm.

---

### Module 4: Leadership Activity Log

A running record of decisions and actions — not tied to rule breaks. Useful for promotions, war calls, recruitment decisions, standing policies.

```
LeadershipLog
  └── id (PK)
  └── logged_by (player_tag)
  └── logged_at
  └── category (enum: promotion / demotion / war / recruitment / capital / general)
  └── clan_id (FK → Clan, optional)
  └── related_person_id (FK → Person, optional)
  └── description (free text)
  └── pinned (bool)
```

- Any leader can add an entry
- Pinned entries stay at top
- Filterable by category, clan, date, related person
- Global by default — cross-clan decisions visible to all leaders

---

### Module 5: Clan Sync

**Scope rules:**
- Updates `PlayerAccount` for **elder/member** accounts: name, TH level, trophies, donations, in-game role
- For **leader/co-leader** accounts: `in_game_name` and `th_level` only. Never touches `db_role` or `access_enabled`
- New tags → unlinked `PlayerAccount` created, flagged for review
- Tags gone from roster → `status: left`

**Triggers:**
- On dashboard load (debounced per-clan — interval from Settings, default 5 min)
- Manual "Sync Now" per clan in Settings
- Scheduled: daily via Vercel Cron (one job — the only cron slot needed)

**Sync log:** Per-clan last sync time and result shown in the dashboard header.

---

## 7. Settings Reference

All editable by Super Admin. Stored in DB. Read at runtime.

| Key | Type | Default | Description |
|---|---|---|---|
| `sync_interval_minutes` | int | 5 | Min minutes between auto-syncs per clan |
| `sync_auto_enabled` | bool | true | Sync on dashboard load |
| `warning_escalation_days` | int | 3 | Days until unacknowledged warning becomes HIGH |
| `cross_clan_warning_visibility` | bool | true | All leaders see all family warnings |
| `clan_display_order` | JSON | auto | Sidebar order for clans |

---

## 8. Technical Architecture

### 8.1 Stack

| Layer | Choice | Cost |
|---|---|---|
| Frontend + Backend | Next.js (React + API routes) | Free (Vercel) |
| Database | Supabase PostgreSQL (free tier) | Free |
| Hosting | Vercel (free tier) | Free |
| Scheduled jobs | Vercel Cron (1 job: daily sync) | Free |
| CoC API proxy | Small VPS (e.g., Hetzner CX11) | ~$4/month |

**Total: ~$4/month.** Cron slot freed by removing Capital Radar — one slot now available for future use.

### 8.2 Data Flow

```
Browser
  └─→ Next.js API routes (server)
          ├─→ VPS proxy → CoC API   (auth check, roster sync)
          └─→ Supabase DB           (all stored data)
```

### 8.3 Scalability Notes

- Adding a 4th clan: insert a row in `clans` table. No code change.
- Adding a new setting: insert a row in `settings` table. UI reads it dynamically.
- Adding a new rule: insert a row in `rules` table via the Settings UI.

---

## 9. User Experience

### 9.1 Login

- Single input: player tag
- Server checks DB first (Layer 2). If not found, checks CoC API (Layer 1).
- Error states: "Tag not found in any clan" / "Your account doesn't have access"
- No registration, no password, no email — ever

### 9.2 Dashboard Layout

**Top bar:** Clan switcher (Main / Feeder 1 / Feeder 2 / All) + logged-in player name + per-clan sync status

**Left sidebar:**
- Home
- Members
- Warnings
- Activity Log
- Settings *(Super Admin only)*

**Home overview cards:**
- HIGH warnings (red — action needed today)
- Pending warnings (yellow — needs acknowledgement)
- Unlinked accounts (per clan — new members needing assignment)
- Last sync time per clan

### 9.3 Logging a Warning

Quick-log flow from any screen:
1. Select Person (or search by tag/name)
2. Select which PlayerAccount the warning relates to
3. Optionally select a Rule from the library — `logging_guidance` appears inline if the rule has one
4. Write description (free text — the actual context)
5. Submit → warning appears in queue as pending acknowledgement

The Capital Sandbagging rule's `logging_guidance` reads: *"Log during the raid weekend — you won't be able to verify this afterwards. Note the district name, approximate destruction % when they switched, and which district they attacked instead."*

---

## 10. Scope & Phasing

### v1 — MVP

- [ ] Tag-based auth with DB-driven role table
- [ ] Super Admin setup + leadership management UI
- [ ] Settings page (all configurable values)
- [ ] Clan family (3 clans, scalable via data)
- [ ] Clan sync (elder/member only, leaders protected)
- [ ] Member registry (Persons + PlayerAccounts + alt linking)
- [ ] Rule Library (seeded with default rules, editable)
- [ ] Warning system (manual logging + HIGH escalation)
- [ ] Dashboard home with warning queue

### v2 — Enrich

- [ ] Leadership activity log
- [ ] Per-person profile page (full history: all accounts, all warnings with PlayerAccount shown)
- [ ] Cross-clan member promotion flow (feeder → main)
- [ ] Warning filter / search improvements

### v3 — Stretch

- [ ] Elder read-only access tier
- [ ] Export to CSV / PDF
- [ ] War attendance tracker (pull from `/currentwar`)
- [ ] Donation ratio tracking over seasons
- [ ] Capital participation tracker (did they use all their attacks?) — read-only display, no automation

---

## 11. Decisions Log

| # | Question | Decision |
|---|---|---|
| 1 | How many clans? | 3, row-based — adding more is a data op, not a code change |
| 2 | Capital automated detection? | Removed. API timing and scenario coverage gaps make it unreliable. Capital rule lives in Rule Library as manual Warning with logging guidance. |
| 3 | Warning severity? | Single level: Warning. Escalates to HIGH (computed) after `warning_escalation_days` |
| 4 | Cross-clan warning visibility? | Configurable in Settings (default: on) |
| 5 | Warning linked to PlayerAccount? | Yes — every warning stores the specific tag, shown alongside Person name |
| 6 | Leader sync protection? | Sync never touches leadership table. Super Admin controls roles and access. |
| 7 | False positives / dismissals? | Not applicable — no automated flags. Manual warnings are reviewed by humans before logging. |

---

## 12. Success Criteria

- Leader access survives any sync event
- A new member is fully onboarded (accounts linked) in under 2 minutes
- HIGH warnings visible within 5 seconds of login
- Capital sandbagging can be logged in under 30 seconds during a live raid weekend
- All enforcement-relevant configuration lives in Settings UI — zero code changes needed for tuning
- Adding a 4th clan requires no code change

---

*End of PRD v0.4*
