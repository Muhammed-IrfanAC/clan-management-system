-- Configurable role capabilities (overrides layer).
--
-- The capability model in src/lib/permissions.ts stays the source of the DEFAULTS. This table only
-- stores OVERRIDES: for a given (role, capability), an explicit enabled flag that wins over the code
-- default. A role/capability with no row here falls back to the coded default, so an empty table
-- reproduces today's behaviour exactly.
--
-- Scope in the UI: only the co_leader row set is editable (the single-owner model keeps super_admin
-- and leader coded). The table is general, but the editor and the /api/permissions route only ever
-- write role = 'co_leader'.
CREATE TABLE IF NOT EXISTS role_capabilities (
    role       TEXT NOT NULL,
    capability TEXT NOT NULL,
    enabled    BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (role, capability)
);
