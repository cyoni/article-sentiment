-- Include the equality predicate so SQLite can use this index for both the
-- completed-status filter and the alert queue's delivery order.
DROP INDEX IF EXISTS articles_completed_alert_queue_idx;

CREATE INDEX IF NOT EXISTS articles_alert_queue_idx
    ON articles (sentiment_status, sentiment_at, id);
