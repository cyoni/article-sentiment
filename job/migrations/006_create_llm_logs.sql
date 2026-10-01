CREATE TABLE IF NOT EXISTS llm_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    candidate_id INTEGER,
    article_id INTEGER,
    operation TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_version TEXT NOT NULL,
    request_json TEXT,
    response_text TEXT,
    result_json TEXT,
    status TEXT NOT NULL
        CHECK (status IN ('success', 'error', 'skipped')),
    error_message TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT llm_logs_candidate_fk
        FOREIGN KEY (candidate_id) REFERENCES candidates (id),
    CONSTRAINT llm_logs_article_fk
        FOREIGN KEY (article_id) REFERENCES articles (id)
);

CREATE INDEX IF NOT EXISTS llm_logs_candidate_id_idx
    ON llm_logs (candidate_id);

CREATE INDEX IF NOT EXISTS llm_logs_article_id_idx
    ON llm_logs (article_id);

CREATE INDEX IF NOT EXISTS llm_logs_created_at_idx
    ON llm_logs (created_at);
