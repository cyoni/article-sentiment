-- Supports the sentiment job's pending/error queue in article-id order.
CREATE INDEX IF NOT EXISTS articles_sentiment_queue_idx
    ON articles (id)
    WHERE sentiment IS NULL
      AND sentiment_status IN ('pending', 'error');
