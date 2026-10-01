ALTER TABLE candidates
ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0
CHECK (needs_review IN (0, 1));

CREATE INDEX IF NOT EXISTS candidates_needs_review_idx
    ON candidates (needs_review);
