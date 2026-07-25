-- One-time, non-punitive rule reminders. Better Late Than Never uses this to avoid sending the
-- same cutoff reminder again on every cron scan; it is deliberately separate from strikes and
-- strike_violations because a reminder is not a disciplinary event.
CREATE TABLE IF NOT EXISTS rule_reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID REFERENCES rules(id) ON DELETE SET NULL,
    person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    player_account_tag TEXT NOT NULL REFERENCES player_accounts(player_tag) ON DELETE CASCADE,
    clan_id UUID REFERENCES clans(id) ON DELETE SET NULL,
    war_source TEXT NOT NULL CHECK (war_source IN ('regular', 'cwl')),
    war_round_id UUID NOT NULL,
    reminder_key TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (reminder_key)
);
CREATE INDEX IF NOT EXISTS idx_rule_reminders_round ON rule_reminders(war_source, war_round_id);
