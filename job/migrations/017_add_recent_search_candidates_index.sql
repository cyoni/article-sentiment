-- Supports loading a company's recent RSS candidates before URL decoding.
CREATE INDEX IF NOT EXISTS candidates_company_recent_rss_idx
    ON candidates (
        company_id,
        datetime(COALESCE(published_at, created_at))
    )
    WHERE rss_url IS NOT NULL;
