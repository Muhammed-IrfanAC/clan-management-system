-- Attribute baby lifecycle actions to the acting leader via leadership_logs.
-- Creating a baby logs a 'recruitment' action; promoting one logs a 'promotion'
-- action. Both are stamped with the leader's player_tag (logged_by), so the
-- existing Leadership Performance graph counts them with no chart changes.

-- When a baby's trial lapses we delete the person record. Any leadership_logs
-- referencing that person (e.g. the recruitment credit) must not block the
-- delete or dangle — keep the log, drop the person reference.
ALTER TABLE leadership_logs DROP CONSTRAINT IF EXISTS leadership_logs_related_person_id_fkey;
ALTER TABLE leadership_logs ADD CONSTRAINT leadership_logs_related_person_id_fkey
    FOREIGN KEY (related_person_id) REFERENCES persons(id) ON DELETE SET NULL;
