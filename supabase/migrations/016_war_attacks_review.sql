-- Per-attack detail + opponent lineups + a leader-review queue.
--
-- The missed-attack detector only needed our members' aggregate attack COUNT. The two judgement
-- rules (unjustified hit-up, low-rank late snipe) need more: which base each of our attacks hit,
-- the opponent's full lineup (to know which equal/lower bases sat OPEN), and — for late snipe —
-- WHEN the attack happened. The CoC API gives attacks an `order` but no timestamp, so timing is
-- inferred from when we first observed the attack across the 5-minute sync polls (first_seen_at).
--
-- These rules are judgement calls, so their detections are NOT auto-logged — they land in
-- warning_suggestions for a leader to confirm (-> a real warning) or dismiss.

-- ---- Opponent lineup snapshot (their bases + TH levels, incl. ones nobody attacked) ----
ALTER TABLE war_rounds ADD COLUMN IF NOT EXISTS opponent_lineup JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE cwl_rounds ADD COLUMN IF NOT EXISTS opponent_lineup JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---- Our per-attack rows, for regular wars ----
-- One row per attack made by our side. attack_order is the war-global attack order (unique within a
-- war), used to reconstruct which enemy bases were still open at the moment of each attack. Attack
-- results are immutable once completed, so rows are inserted once (ON CONFLICT DO NOTHING) and their
-- first_seen_at is preserved — that timestamp, minus the round end_time, is how "in the final N
-- hours" is judged. first_seen_state records the war state at first sighting so timing captured only
-- after the war ended (unreliable) can be ignored by the detector.
CREATE TABLE IF NOT EXISTS war_attacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID NOT NULL REFERENCES war_rounds(id) ON DELETE CASCADE,
    attack_order INT NOT NULL,
    attacker_tag TEXT NOT NULL,
    attacker_name TEXT,
    attacker_person_id UUID REFERENCES persons(id) ON DELETE SET NULL,
    attacker_th INT,
    attacker_rank TEXT,               -- db_role at ingest ('member'|'elder'|'co_leader'|'leader'|…)
    defender_tag TEXT NOT NULL,
    defender_th INT,
    stars INT NOT NULL DEFAULT 0,
    destruction REAL NOT NULL DEFAULT 0,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_seen_state TEXT,            -- war.state when first observed ('inWar' => reliable timing)
    UNIQUE (round_id, attack_order)
);
CREATE INDEX IF NOT EXISTS idx_war_attacks_round ON war_attacks(round_id);

-- ---- Our per-attack rows, for CWL wars (identical shape, separate table like the members split) ----
CREATE TABLE IF NOT EXISTS cwl_war_attacks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID NOT NULL REFERENCES cwl_rounds(id) ON DELETE CASCADE,
    attack_order INT NOT NULL,
    attacker_tag TEXT NOT NULL,
    attacker_name TEXT,
    attacker_person_id UUID REFERENCES persons(id) ON DELETE SET NULL,
    attacker_th INT,
    attacker_rank TEXT,
    defender_tag TEXT NOT NULL,
    defender_th INT,
    stars INT NOT NULL DEFAULT 0,
    destruction REAL NOT NULL DEFAULT 0,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_seen_state TEXT,
    UNIQUE (round_id, attack_order)
);
CREATE INDEX IF NOT EXISTS idx_cwl_war_attacks_round ON cwl_war_attacks(round_id);

-- ---- Leader-review queue for judgement-mode detectors ----
-- A detected-but-unconfirmed violation. dedup_key is stable per real-world violation (same key as an
-- auto-warning would use), UNIQUE so a re-scan every few minutes never re-queues the same item — and
-- a DISMISSED row keeps its key so it is never re-suggested. On confirm we create a real warning and
-- point warning_id at it. evidence carries the context a leader needs to judge (TH levels, remaining
-- time, which bases sat open).
CREATE TABLE IF NOT EXISTS warning_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES rules(id) ON DELETE SET NULL,
    person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    player_account_tag TEXT NOT NULL,
    clan_id UUID REFERENCES clans(id) ON DELETE SET NULL,
    member_name TEXT,
    description TEXT NOT NULL,
    dedup_key TEXT NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ,
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'confirmed' | 'dismissed'
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    warning_id UUID REFERENCES warnings(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS warning_suggestions_dedup_key_uidx ON warning_suggestions(dedup_key);
CREATE INDEX IF NOT EXISTS idx_warning_suggestions_status ON warning_suggestions(status);

-- Pre-wire the two judgement rules (disabled; a leader enables + tunes them in Settings).
UPDATE rules SET automation_key = 'war_unjustified_hitup'
WHERE automation_key IS NULL AND lower(name) LIKE '%hit%up%';

UPDATE rules SET automation_key = 'war_late_snipe'
WHERE automation_key IS NULL AND (lower(name) LIKE '%snipe%' OR lower(name) LIKE '%late%attack%');
