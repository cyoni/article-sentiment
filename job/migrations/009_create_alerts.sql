CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_date TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    article_count INTEGER NOT NULL DEFAULT 0,
    subject TEXT NOT NULL,
    body_text TEXT NOT NULL,
    body_html TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    provider_message_id TEXT,
    sent_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_articles (
    alert_id INTEGER NOT NULL,
    article_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (alert_id, article_id),
    CONSTRAINT alert_articles_alert_fk
        FOREIGN KEY (alert_id) REFERENCES alerts (id),
    CONSTRAINT alert_articles_article_fk
        FOREIGN KEY (article_id) REFERENCES articles (id)
);

CREATE INDEX IF NOT EXISTS alert_articles_article_id_idx
    ON alert_articles (article_id);

CREATE TRIGGER IF NOT EXISTS alerts_updated_at
AFTER UPDATE ON alerts
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE alerts
    SET updated_at = datetime('now')
    WHERE id = OLD.id;
END;
