-- Better Late Than Never now records only confirmed late-snipe strikes; the reminder path and its
-- delivery-dedup table are no longer used.
DROP TABLE IF EXISTS rule_reminders;
