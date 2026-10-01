CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id INTEGER NOT NULL,
    article_id INTEGER,
    title TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    source TEXT NOT NULL,
    query TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'relevant', 'not_relevant')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT candidates_company_fk
        FOREIGN KEY (company_id) REFERENCES companies (id),
    CONSTRAINT candidates_article_fk
        FOREIGN KEY (article_id) REFERENCES articles (id)
);

CREATE INDEX IF NOT EXISTS candidates_company_id_idx
    ON candidates (company_id);

CREATE INDEX IF NOT EXISTS candidates_article_id_idx
    ON candidates (article_id);

CREATE INDEX IF NOT EXISTS candidates_status_idx
    ON candidates (status);

CREATE INDEX IF NOT EXISTS candidates_canonical_url_idx
    ON candidates (canonical_url);

CREATE TRIGGER IF NOT EXISTS candidates_updated_at
AFTER UPDATE ON candidates
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE candidates
    SET updated_at = datetime('now')
    WHERE id = OLD.id;
END;
