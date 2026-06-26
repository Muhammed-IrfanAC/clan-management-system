-- Warning notes + editable warnings.
--
-- 1) warning_notes: a threaded progress log attached to a warning. Any leader may add a
--    note, but a note can only be edited or deleted by its AUTHOR PERSON (resolved at the
--    persona level, so any alt of the author can manage it too — mirrors baby_comments).
--    Notes cascade away if the parent warning is deleted.
-- 2) warnings.edited_at: stamped whenever the warning's author edits the rule / date /
--    description, so the UI can surface an "(edited)" marker. NULL = never edited.

CREATE TABLE IF NOT EXISTS warning_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warning_id UUID NOT NULL REFERENCES warnings(id) ON DELETE CASCADE,
    author_tag TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warning_notes_warning_id ON warning_notes(warning_id);

ALTER TABLE warnings ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
