-- Baby comment system: a threaded log of leader notes attached to a baby (probationary)
-- persona. Comments can only be added/edited/deleted while the persona is in its baby
-- trial (persons.is_baby = true); after promotion they are frozen (read-only). When a baby
-- trial lapses the persona is deleted, so its comments cascade away with it.
CREATE TABLE IF NOT EXISTS baby_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
    author_tag TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_baby_comments_person_id ON baby_comments(person_id);
