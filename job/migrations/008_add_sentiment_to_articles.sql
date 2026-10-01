ALTER TABLE articles
ADD COLUMN sentiment TEXT
    CHECK (sentiment IS NULL OR sentiment IN ('positive', 'negative', 'neutral'));

ALTER TABLE articles
ADD COLUMN sentiment_confidence REAL
    CHECK (sentiment_confidence IS NULL OR (sentiment_confidence >= 0 AND sentiment_confidence <= 1));

ALTER TABLE articles
ADD COLUMN sentiment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (sentiment_status IN ('pending', 'completed', 'needs_review', 'error'));

ALTER TABLE articles
ADD COLUMN sentiment_at TEXT;

CREATE INDEX IF NOT EXISTS articles_sentiment_status_idx
    ON articles (sentiment_status);
