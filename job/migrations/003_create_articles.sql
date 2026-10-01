CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    candidate_id INTEGER,
    title TEXT NOT NULL,
    canonical_url TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL,
    published_at TEXT,
    content TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT articles_company_fk
        FOREIGN KEY (company_id) REFERENCES companies (id),
    CONSTRAINT articles_candidate_fk
        FOREIGN KEY (candidate_id) REFERENCES candidates (id)
);

CREATE INDEX IF NOT EXISTS articles_company_id_idx
    ON articles (company_id);

CREATE INDEX IF NOT EXISTS articles_candidate_id_idx
    ON articles (candidate_id);

CREATE INDEX IF NOT EXISTS articles_published_at_idx
    ON articles (published_at);

CREATE TRIGGER IF NOT EXISTS articles_updated_at
AFTER UPDATE ON articles
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE articles
    SET updated_at = datetime('now')
    WHERE id = OLD.id;
END;
