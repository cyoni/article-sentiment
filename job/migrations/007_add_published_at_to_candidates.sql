ALTER TABLE candidates
ADD COLUMN published_at TEXT;

CREATE INDEX IF NOT EXISTS candidates_published_at_idx
    ON candidates (published_at);
