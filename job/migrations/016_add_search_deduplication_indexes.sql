-- Supports per-company candidate deduplication by resolved publisher URL or
-- original Google News RSS URL.
CREATE INDEX IF NOT EXISTS candidates_company_canonical_url_idx
    ON candidates (company_id, canonical_url);

CREATE INDEX IF NOT EXISTS candidates_company_rss_url_idx
    ON candidates (company_id, rss_url);
