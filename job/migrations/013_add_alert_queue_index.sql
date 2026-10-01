-- Supports the alert job's completed-article queue in delivery order.
CREATE INDEX IF NOT EXISTS articles_completed_alert_queue_idx
    ON articles (sentiment_at, id)
    WHERE sentiment_status = 'completed';
