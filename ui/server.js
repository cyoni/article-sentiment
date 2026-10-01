import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const uiDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(uiDirectory, '..');
const databasePath = join(projectRoot, 'job', 'data', 'ourcrowd.db');
const distDirectory = join(uiDirectory, 'dist');
const port = Number.parseInt(process.env.PORT ?? '3001', 10);
const app = express();

function slugify(value) {
    return value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function periodStart() {
    return "datetime('now', '-90 days')";
}

function withDatabase(callback) {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
        return callback(database);
    } finally {
        database.close();
    }
}

function sendInternalError(response, error) {
    console.error('Dashboard API request failed:', error);
    response.status(500).json({ error: 'Internal server error' });
}

app.get('/api/companies', (request, response) => {
    try {
        const companies = withDatabase((database) => database.prepare(`
            SELECT
                c.id,
                c.name,
                c.domain,
                MAX(a.published_at) AS last_published_at,
                COUNT(a.id) AS article_count,
                COALESCE(SUM(CASE WHEN a.sentiment = 'positive' THEN 1 ELSE 0 END), 0) AS positive_count,
                COALESCE(SUM(CASE WHEN a.sentiment = 'negative' THEN 1 ELSE 0 END), 0) AS negative_count,
                COALESCE(SUM(CASE WHEN a.sentiment = 'neutral' THEN 1 ELSE 0 END), 0) AS neutral_count
            FROM companies c
            LEFT JOIN articles a
                ON a.company_id = c.id
                AND a.sentiment_status = 'completed'
                AND a.published_at IS NOT NULL
                AND datetime(a.published_at) >= ${periodStart()}
            WHERE c.is_active = 1
            GROUP BY c.id
            ORDER BY last_published_at IS NULL, last_published_at DESC, lower(c.name)
        `).all());
        response.json({
            period_days: 90,
            companies,
        });
    } catch (error) {
        sendInternalError(response, error);
    }
});

app.get('/api/companies/:companyId/articles', (request, response) => {
    const companyIdentifier = request.params.companyId;
    if (!companyIdentifier) {
        response.status(400).json({ error: 'Invalid company identifier' });
        return;
    }

    try {
        const result = withDatabase((database) => {
            const numericId = Number.parseInt(companyIdentifier, 10);
            let company;
            let ambiguous = false;
            if (Number.isInteger(numericId) && String(numericId) === companyIdentifier) {
                company = database.prepare('SELECT id, name, domain FROM companies WHERE id = ? AND is_active = 1').get(numericId);
            } else {
                const matches = database.prepare('SELECT id, name, domain FROM companies WHERE is_active = 1').all()
                    .filter((item) => slugify(item.name) === companyIdentifier);
                ambiguous = matches.length > 1;
                company = matches.length === 1 ? matches[0] : null;
            }
            if (!company) return { ambiguous };

            const articles = database.prepare(`
                SELECT id, title, canonical_url, source, published_at, sentiment, sentiment_confidence
                FROM articles
                WHERE company_id = ?
                  AND sentiment_status = 'completed'
                  AND published_at IS NOT NULL
                  AND datetime(published_at) >= ${periodStart()}
                ORDER BY datetime(published_at) DESC, id DESC
            `).all(company.id);
            return { company, articles, period_days: 90 };
        });

        if (!result.company) {
            response.status(result.ambiguous ? 409 : 404).json({
                error: result.ambiguous ? 'Company identifier is ambiguous' : 'Company not found',
            });
            return;
        }
        response.json(result);
    } catch (error) {
        sendInternalError(response, error);
    }
});

if (existsSync(distDirectory)) {
    app.use(express.static(distDirectory));
    app.use((_request, response) => response.sendFile(join(distDirectory, 'index.html')));
}

app.listen(port, () => {
    console.log(`OurCrowd dashboard server listening on http://localhost:${port}`);
});
