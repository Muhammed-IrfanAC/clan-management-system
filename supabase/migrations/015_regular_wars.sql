-- Regular (non-CWL) clan war tracking.
--
-- Mirrors the CWL round/member model (migration 012) but for the standard clan-war endpoint
-- (/clans/{tag}/currentwar). Unlike CWL there is no persistent war tag, so a war is identified for a
-- clan by its preparation start time — a clan is only ever in one war at a time, making
-- (clan_id, prep_start_time) a stable natural key that upserts idempotently across polls.
--
-- Regular wars give each member TWO attacks (attacks_per_member), so "missed" means fewer attacks
-- used than allowed — the detector reads attacks_per_member rather than assuming one.

CREATE TABLE IF NOT EXISTS war_rounds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clan_id UUID NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
    prep_start_time TIMESTAMPTZ,      -- identifies the specific war for this clan (natural key)
    state TEXT NOT NULL,              -- 'preparation' | 'inWar' | 'warEnded'
    team_size INT,
    attacks_per_member INT,           -- regular war = 2 (occasionally 1)
    opponent_name TEXT,
    opponent_tag TEXT,
    our_stars INT DEFAULT 0,
    our_destruction REAL DEFAULT 0,
    our_attacks_used INT DEFAULT 0,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    polled_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (clan_id, prep_start_time)
);

CREATE TABLE IF NOT EXISTS war_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id UUID NOT NULL REFERENCES war_rounds(id) ON DELETE CASCADE,
    person_id UUID REFERENCES persons(id) ON DELETE SET NULL,
    player_tag TEXT NOT NULL,
    name TEXT,
    th_level INT,
    map_position INT,
    attacks_used INT DEFAULT 0,       -- 0..attacks_per_member
    stars INT DEFAULT 0,
    destruction REAL DEFAULT 0,
    UNIQUE (round_id, player_tag)
);

CREATE INDEX IF NOT EXISTS idx_war_rounds_clan ON war_rounds(clan_id);
CREATE INDEX IF NOT EXISTS idx_war_members_round ON war_members(round_id);
