-- Strike Management System (Phase 1): the event-driven discipline model that replaces warnings.
--
-- Core mechanic: a STRIKE is one row per (person, single war). A regular war is one war; each CWL
-- round is its own war. Multiple rule-breaks in the SAME war fold into ONE strike as separate
-- strike_violations ("all their violations should be visible"). A strike is ACTIVE while its
-- issued_at falls inside the rolling 90-day window — and ONLY that 90-day expiry ever removes a
-- strike from the active count (the trust-restoration checklist is a leader reference marker, like
-- the old 'acknowledge'; it clears the demotion/eligibility INTENT but never the strike). Status
-- (active count, Green/Orange/Red, war eligibility, removal-at-3) is DERIVED in src/lib/strikes/*.

-- 1. STRIKES ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strikes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    player_account_tag TEXT REFERENCES player_accounts(player_tag),
    clan_id UUID REFERENCES clans(id) ON DELETE SET NULL,
    rule_id UUID REFERENCES rules(id) ON DELETE SET NULL,   -- primary rule; per-break detail in strike_violations
    -- War identity: one strike per (person, war). war_round_id points at war_rounds OR cwl_rounds
    -- (disambiguated by war_source); no FK because it spans two tables. NULL for manual/legacy.
    war_source TEXT NOT NULL DEFAULT 'manual' CHECK (war_source IN ('regular', 'cwl', 'manual', 'legacy')),
    war_round_id UUID,
    war_label TEXT,                                          -- human label e.g. 'CWL Round 3 vs X'
    -- Stable per-(person,war) key => idempotent auto-creation + the "one strike per war" guarantee.
    -- NULL for manual/legacy strikes; a plain UNIQUE index treats NULLs as distinct, so a leader may
    -- log several manual strikes without collision.
    strike_key TEXT,
    origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('auto', 'manual', 'review')),
    -- Drives the rolling 90-day expiry. There is deliberately NO stored expires_at column:
    -- `timestamptz + interval` is only STABLE (day arithmetic depends on the session TimeZone), so
    -- Postgres rejects it in a generated column. Expiry is derived instead — STRIKE_WINDOW_DAYS /
    -- isActive() / expiryOf() in src/lib/strikes/status.ts — and queries filter on issued_at.
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    logged_by TEXT NOT NULL DEFAULT 'SYSTEM',
    -- Trust restoration: a leader-marked checklist. Completing it (leadership_approved) clears the
    -- should-be-Member / war-ineligible INTENT for this strike, but never removes the strike itself.
    owned BOOLEAN NOT NULL DEFAULT FALSE,
    apologised BOOLEAN NOT NULL DEFAULT FALSE,
    understands_rule BOOLEAN NOT NULL DEFAULT FALSE,
    promised BOOLEAN NOT NULL DEFAULT FALSE,
    leadership_approved BOOLEAN NOT NULL DEFAULT FALSE,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    elder_restored_at TIMESTAMPTZ,      -- when a leader confirms the in-game Elder re-promotion
    war_eligible_at TIMESTAMPTZ,        -- when a leader confirms war eligibility restored
    -- Third-strike removal (a leader kicks in-game; we record the intent + dates).
    removal_at TIMESTAMPTZ,
    rejoin_at TIMESTAMPTZ,
    discord_message_id TEXT,            -- reserved (no bot yet); for a future two-way integration
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Plain UNIQUE index: NULL strike_keys are distinct (manual strikes never collide); non-NULL keys
-- give the "one strike per (person, war)" guarantee and let auto-creation upsert idempotently.
CREATE UNIQUE INDEX IF NOT EXISTS strikes_strike_key_uidx ON strikes(strike_key);
CREATE INDEX IF NOT EXISTS idx_strikes_person ON strikes(person_id);
CREATE INDEX IF NOT EXISTS idx_strikes_issued_at ON strikes(issued_at);
CREATE INDEX IF NOT EXISTS idx_strikes_clan ON strikes(clan_id);

-- 2. STRIKE VIOLATIONS --------------------------------------------------------
-- The individual rule-breaks folded into a strike. dedup_key is stable per real-world violation, so
-- re-scanning appends nothing new (idempotent) and both hits of the same war fold into one strike.
CREATE TABLE IF NOT EXISTS strike_violations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strike_id UUID NOT NULL REFERENCES strikes(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES rules(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    dedup_key TEXT NOT NULL,
    occurred_at TIMESTAMPTZ,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'manual', 'review'))
);
CREATE UNIQUE INDEX IF NOT EXISTS strike_violations_dedup_key_uidx ON strike_violations(dedup_key);
CREATE INDEX IF NOT EXISTS idx_strike_violations_strike ON strike_violations(strike_id);

-- 3. STRIKE NOTES (leader discussion thread; mirrors the old warning_notes) ----
CREATE TABLE IF NOT EXISTS strike_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    strike_id UUID NOT NULL REFERENCES strikes(id) ON DELETE CASCADE,
    author_tag TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_strike_notes_strike ON strike_notes(strike_id);

-- 4. STRIKE SUGGESTIONS (review queue for judgement detectors, e.g. hit-up) ----
-- On confirm, folds into the (person, war) strike as a violation — never a 2nd strike. war identity
-- lets a confirm attach to an already-existing auto strike for the same war.
CREATE TABLE IF NOT EXISTS strike_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES rules(id) ON DELETE SET NULL,
    person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    player_account_tag TEXT NOT NULL,
    clan_id UUID REFERENCES clans(id) ON DELETE SET NULL,
    member_name TEXT,
    war_source TEXT NOT NULL DEFAULT 'manual' CHECK (war_source IN ('regular', 'cwl', 'manual', 'legacy')),
    war_round_id UUID,
    war_label TEXT,
    description TEXT NOT NULL,
    dedup_key TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'confirmed' | 'dismissed'
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    strike_id UUID REFERENCES strikes(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS strike_suggestions_dedup_key_uidx ON strike_suggestions(dedup_key);
CREATE INDEX IF NOT EXISTS idx_strike_suggestions_status ON strike_suggestions(status);

-- 5. MIGRATE EXISTING WARNINGS -> STRIKES -------------------------------------
-- Rollout decision: import as ACTIVE (issued_at = the original logged_at, so the rolling 90-day
-- window applies retroactively — anything older than 90 days imports already-expired, for history).
-- An old warning that was 'acknowledged' maps to leadership_approved (its acknowledge WAS the
-- leader's resolution marker); everything else imports unresolved. clan_id is resolved from the
-- account's current clan (old warnings carried none). Keyed off a per-warning legacy strike_key so a
-- re-run never double-imports. The old warnings/warning_notes/warning_suggestions tables are LEFT
-- INTACT as a read-only backup — a later migration drops them once the strike system is proven.
INSERT INTO strikes (
    person_id, player_account_tag, clan_id, rule_id, war_source, strike_key, origin,
    issued_at, logged_by, leadership_approved, approved_at, approved_by, notes, created_at
)
SELECT
    w.person_id,
    w.player_account_tag,
    pa.clan_id,
    w.rule_id,
    'legacy',
    'legacy_warning:' || w.id::text,
    CASE WHEN w.source = 'auto' THEN 'auto' ELSE 'manual' END,
    COALESCE(w.logged_at, NOW()),
    w.logged_by,
    COALESCE(w.acknowledged, FALSE),
    w.acknowledged_at,
    CASE WHEN w.acknowledged THEN w.logged_by ELSE NULL END,
    w.notes,
    COALESCE(w.logged_at, NOW())
FROM warnings w
LEFT JOIN player_accounts pa ON pa.player_tag = w.player_account_tag
WHERE w.person_id IS NOT NULL
ON CONFLICT (strike_key) DO NOTHING;

-- One violation per migrated warning (its description + rule become the strike's single break).
INSERT INTO strike_violations (strike_id, rule_id, description, dedup_key, occurred_at, detected_at, source)
SELECT
    s.id,
    w.rule_id,
    w.description,
    COALESCE(w.dedup_key, 'legacy_warning:' || w.id::text),
    w.logged_at,
    COALESCE(w.logged_at, NOW()),
    CASE WHEN w.source = 'auto' THEN 'auto' ELSE 'manual' END
FROM warnings w
JOIN strikes s ON s.strike_key = 'legacy_warning:' || w.id::text
WHERE w.person_id IS NOT NULL
ON CONFLICT (dedup_key) DO NOTHING;

-- Preserve the leader discussion thread.
INSERT INTO strike_notes (strike_id, author_tag, body, created_at, updated_at)
SELECT s.id, wn.author_tag, wn.body, wn.created_at, wn.updated_at
FROM warning_notes wn
JOIN warnings w ON w.id = wn.warning_id
JOIN strikes s ON s.strike_key = 'legacy_warning:' || w.id::text
WHERE NOT EXISTS (
    SELECT 1 FROM strike_notes sn
    WHERE sn.strike_id = s.id AND sn.author_tag = wn.author_tag
      AND sn.body = wn.body AND sn.created_at = wn.created_at
);

-- Carry over the review queue. dedup_key is preserved so dismissed items never reappear and the new
-- scan won't re-queue a still-pending one. war_source / war_round_id are parsed back out of the old
-- dedup_key (`<rule>:<source>:<roundId>:<personId>`) so a confirm can fold into the right war strike.
INSERT INTO strike_suggestions (
    rule_id, person_id, player_account_tag, clan_id, member_name, war_source, war_round_id,
    description, dedup_key, evidence, occurred_at, detected_at, status, reviewed_by, reviewed_at
)
SELECT
    ws.rule_id, ws.person_id, ws.player_account_tag, ws.clan_id, ws.member_name,
    CASE WHEN split_part(ws.dedup_key, ':', 2) IN ('regular', 'cwl')
         THEN split_part(ws.dedup_key, ':', 2) ELSE 'manual' END,
    CASE WHEN split_part(ws.dedup_key, ':', 3) ~ '^[0-9a-fA-F-]{36}$'
         THEN split_part(ws.dedup_key, ':', 3)::uuid ELSE NULL END,
    ws.description, ws.dedup_key, ws.evidence, ws.occurred_at, ws.detected_at,
    ws.status, ws.reviewed_by, ws.reviewed_at
FROM warning_suggestions ws
ON CONFLICT (dedup_key) DO NOTHING;
