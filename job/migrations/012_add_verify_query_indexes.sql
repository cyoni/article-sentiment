-- Supports the verifier's ready-candidate queue without scanning reviewed rows.
CREATE INDEX IF NOT EXISTS candidates_pending_unreviewed_idx
    ON candidates (id)
    WHERE status = 'pending' AND needs_review = 0;

-- Supports per-company recent-article lookup and ordering for duplicate checks.
CREATE INDEX IF NOT EXISTS articles_company_recent_idx
    ON articles (
        company_id,
        COALESCE(published_at, created_at) DESC,
        id DESC
    );
