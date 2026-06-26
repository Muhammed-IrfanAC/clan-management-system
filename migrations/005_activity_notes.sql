-- Activity notes + editable leadership logs.
--
-- Mirrors 004_warning_notes for the Global Leadership Activity feed.
--
-- 1) activity_notes: a threaded progress log attached to a leadership_log entry. Any leader
--    may add a note, but a note can only be edited or deleted by its AUTHOR PERSON (resolved
--    at the persona level, so any alt of the author can manage it too — mirrors baby_comments).
--    Notes cascade away if the parent log entry is deleted.
-- 2) leadership_logs.edited_at: stamped whenever the entry's author edits its
--    category / clan / related person / description / pin, so the UI can surface an
--    "(edited)" marker. NULL = never edited.

CREATE TABLE IF NOT EXISTS activity_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    log_id UUID NOT NULL REFERENCES leadership_logs(id) ON DELETE CASCADE,
    author_tag TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_notes_log_id ON activity_notes(log_id);

ALTER TABLE leadership_logs ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
