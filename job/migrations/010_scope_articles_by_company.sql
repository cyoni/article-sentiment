-- Articles can be shared by multiple tracked companies, so URL uniqueness
-- must be scoped to the company rather than enforced globally.
CREATE TABLE articles_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    candidate_id INTEGER,
    title TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    source TEXT NOT NULL,
    published_at TEXT,
    content TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    rss_url TEXT,
    sentiment TEXT
        CHECK (sentiment IS NULL OR sentiment IN ('positive', 'negative', 'neutral')),
    sentiment_confidence REAL
        CHECK (sentiment_confidence IS NULL OR (sentiment_confidence >= 0 AND sentiment_confidence <= 1)),
    sentiment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (sentiment_status IN ('pending', 'completed', 'needs_review', 'error')),
    sentiment_at TEXT,
    CONSTRAINT articles_company_fk
        FOREIGN KEY (company_id) REFERENCES companies (id),
    CONSTRAINT articles_candidate_fk
        FOREIGN KEY (candidate_id) REFERENCES candidates (id)
);

INSERT INTO articles_new (
    id, company_id, candidate_id, title, canonical_url, source,
    published_at, content, created_at, updated_at, rss_url, sentiment,
    sentiment_confidence, sentiment_status, sentiment_at
)
SELECT
    id, company_id, candidate_id, title, canonical_url, source,
    published_at, content, created_at, updated_at, rss_url, sentiment,
    sentiment_confidence, sentiment_status, sentiment_at
FROM articles;

DROP TABLE articles;
ALTER TABLE articles_new RENAME TO articles;

CREATE UNIQUE INDEX articles_company_url_unique
    ON articles (company_id, canonical_url);

CREATE INDEX articles_company_id_idx
    ON articles (company_id);

CREATE INDEX articles_candidate_id_idx
    ON articles (candidate_id);

CREATE INDEX articles_published_at_idx
    ON articles (published_at);

CREATE INDEX articles_sentiment_status_idx
    ON articles (sentiment_status);

CREATE TRIGGER articles_updated_at
AFTER UPDATE ON articles
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE articles
    SET updated_at = datetime('now')
    WHERE id = OLD.id;
END;
