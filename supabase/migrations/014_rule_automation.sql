-- Rule automation layer.
--
-- Rules become optionally self-detecting. `automation_key` links a rule to a BUILT-IN detector
-- (code, keyed by a stable string — see src/lib/rules/registry.ts); it is NOT executable logic
-- stored in the DB. `automation_config` holds only that detector's tunable parameters (thresholds,
-- lookback windows, etc.) so leaders can retune behaviour without a deploy. `automation_enabled`
-- gates whether the periodic scan actually runs the detector — off by default, so adding the
-- columns never starts logging anything on its own.
ALTER TABLE rules ADD COLUMN IF NOT EXISTS automation_key     TEXT;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS automation_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE rules ADD COLUMN IF NOT EXISTS automation_config  JSONB   NOT NULL DEFAULT '{}'::jsonb;

-- Warnings gain provenance + idempotency so an automated scan can run every few minutes without
-- ever logging the same violation twice.
--   source    = 'manual' (a leader logged it) | 'auto' (a detector logged it)
--   dedup_key = stable identity of an auto-detected violation, e.g. 'war_missed_attack:<roundId>:<tag>'.
--               NULL for manual warnings (many NULLs allowed — NULLs are distinct in a unique index).
ALTER TABLE warnings ADD COLUMN IF NOT EXISTS source    TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE warnings ADD COLUMN IF NOT EXISTS dedup_key TEXT;

-- Non-partial unique index: multiple NULLs coexist, but any two auto rows with the same dedup_key
-- collide, so re-scanning an already-logged violation is a no-op (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS warnings_dedup_key_uidx ON warnings(dedup_key);

-- Convenience: pre-wire the seeded "Miss war attack" rule to the missed-attack detector if it is
-- still present and unautomated. Left DISABLED — a leader must flip it on in Settings before any
-- warning is ever auto-logged.
UPDATE rules SET automation_key = 'war_missed_attack'
WHERE name = 'Miss war attack' AND automation_key IS NULL;
