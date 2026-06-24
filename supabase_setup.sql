-- 1. SETTINGS
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB,
    description TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CLANS
CREATE TABLE IF NOT EXISTS clans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clan_tag TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    clan_type TEXT CHECK (clan_type IN ('main', 'feeder')),
    display_order INT DEFAULT 0,
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PERSONS
CREATE TABLE IF NOT EXISTS persons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL,
    notes TEXT,
    is_baby BOOLEAN NOT NULL DEFAULT FALSE,
    baby_started_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PLAYER ACCOUNTS
CREATE TABLE IF NOT EXISTS player_accounts (
    player_tag TEXT PRIMARY KEY,
    person_id UUID REFERENCES persons(id),
    clan_id UUID REFERENCES clans(id),
    is_main_account BOOLEAN DEFAULT FALSE,
    db_role TEXT CHECK (db_role IN ('super_admin', 'leader', 'co_leader', 'elder', 'member')),
    access_enabled BOOLEAN DEFAULT FALSE,
    status TEXT CHECK (status IN ('active', 'left', 'removed')),
    in_game_name TEXT,
    th_level INT,
    trophies INT,
    donations INT DEFAULT 0,
    donations_received INT DEFAULT 0,
    last_synced_at TIMESTAMPTZ,
    added_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. RULES
CREATE TABLE IF NOT EXISTS rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    logging_guidance TEXT
);

-- 6. WARNINGS
CREATE TABLE IF NOT EXISTS warnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID REFERENCES persons(id) ON DELETE CASCADE,
    player_account_tag TEXT REFERENCES player_accounts(player_tag),
    rule_id UUID REFERENCES rules(id),
    description TEXT NOT NULL,
    logged_by TEXT NOT NULL,
    logged_at TIMESTAMPTZ DEFAULT NOW(),
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_at TIMESTAMPTZ,
    notes TEXT
);

-- 7. LEADERSHIP LOGS
CREATE TABLE IF NOT EXISTS leadership_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    logged_by TEXT NOT NULL,
    logged_at TIMESTAMPTZ DEFAULT NOW(),
    category TEXT CHECK (category IN ('promotion', 'demotion', 'war', 'recruitment', 'capital', 'general')),
    clan_id UUID REFERENCES clans(id),
    related_person_id UUID REFERENCES persons(id),
    description TEXT NOT NULL,
    pinned BOOLEAN DEFAULT FALSE
);

-- SEED INITIAL DATA
INSERT INTO settings (key, value, description) VALUES 
('sync_interval_minutes', '5', 'Min minutes between auto-syncs'),
('sync_auto_enabled', 'true', 'Whether to sync on dashboard load'),
('warning_escalation_days', '3', 'Days until warning becomes HIGH'),
('cross_clan_warning_visibility', 'true', 'All leaders see all warnings'),
('baby_trial_days', '4', 'Days a new "baby" member has to be promoted before the system auto-unlinks them')
ON CONFLICT (key) DO NOTHING;

INSERT INTO rules (name, description, logging_guidance) VALUES 
('Miss war attack', 'Did not use one or both war attacks', 'Note which war and which attack number missed'),
('Donation abuse', 'Repeatedly requesting without donating', 'Note donation ratio at time of log'),
('Capital sandbagging', 'Left a district unfinished to cherry-pick others', 'Log during raid weekend. Note district % left.')
ON CONFLICT DO NOTHING;
