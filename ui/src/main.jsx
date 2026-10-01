import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const sentimentLabels = [
    ['positive', 'Positive'],
    ['negative', 'Negative'],
    ['neutral', 'Neutral'],
];

function formatDate(value) {
    if (!value) return 'No coverage yet';
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value
        : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}


async function getJson(url) {
    const response = await fetch(url);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Request failed');
    return payload;
}

function isSafeExternalUrl(value) {
    try {
        const url = new URL(value);
        return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
    } catch {
        return false;
    }
}

function SentimentPill({ sentiment }) {
    return <span className={`pill pill-${sentiment}`}>{sentiment}</span>;
}

function CompanyTable({ companies }) {
    return (
        <div className="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Company</th>
                        <th>Last published</th>
                        <th>Mentions</th>
                        <th>Sentiment</th>
                    </tr>
                </thead>
                <tbody>
                    {companies.map((company) => (
                        <tr key={company.id} className="company-row">
                            <td>
                                <a className="company-row-link" href={`/companies/${company.id}`} target="_blank" rel="noreferrer">
                                    <div className="company-name">{company.name}</div>
                                    <div className="company-domain">{company.domain || 'Portfolio company'}</div>
                                </a>
                            </td>
                            <td className="date-cell">
                                <a className="company-row-link" href={`/companies/${company.id}`} target="_blank" rel="noreferrer">
                                    {formatDate(company.last_published_at)}
                                </a>
                            </td>
                            <td>
                                <a className="company-row-link" href={`/companies/${company.id}`} target="_blank" rel="noreferrer">
                                    <span className="coverage-count">{company.article_count}</span> articles
                                </a>
                            </td>
                            <td>
                                <a className="company-row-link" href={`/companies/${company.id}`} target="_blank" rel="noreferrer">
                                    <div className="sentiment-summary">
                                        {sentimentLabels.map(([key, label]) => (
                                            <span className={`summary-item summary-${key}`} key={key} title={label}>
                                                <span className="summary-dot" />{company[`${key}_count`]}
                                            </span>
                                        ))}
                                    </div>
                                </a>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {companies.length === 0 && <div className="empty-state">No active companies found.</div>}
        </div>
    );
}

function DashboardPage() {
    const [companies, setCompanies] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        getJson('/api/companies')
            .then((payload) => setCompanies(payload.companies))
            .catch((requestError) => setError(requestError.message))
            .finally(() => setLoading(false));
    }, []);

    return (
        <main className="app-shell">
            <header className="hero">
                <div>
                    <p className="eyebrow">OurCrowd portfolio intelligence</p>
                    <h1>Press monitor</h1>
                    <p className="hero-copy">A clear view of company coverage and sentiment across the rolling 90-day window.</p>
                </div>
                <div className="window-badge"><span className="live-dot" />Rolling 90 days</div>
            </header>

            {error && <div className="error-banner">{error}</div>}
            <section className="dashboard-card">
                <div className="section-heading">
                    <div>
                        <p className="eyebrow">Portfolio overview</p>
                        <h2>Tracked companies</h2>
                    </div>
                    <span className="company-count">{companies.length} active</span>
                </div>
                {loading ? <div className="loading-state">Loading portfolio…</div> : <CompanyTable companies={companies} />}
            </section>
        </main>
    );
}

function CompanyPage({ companyId }) {
    const [company, setCompany] = useState(null);
    const [articles, setArticles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        getJson(`/api/companies/${encodeURIComponent(companyId)}/articles`)
            .then((payload) => {
                setCompany(payload.company);
                setArticles(payload.articles);
            })
            .catch((requestError) => setError(requestError.message))
            .finally(() => setLoading(false));
    }, [companyId]);

    return (
        <main className="app-shell company-page">
            {error && <div className="error-banner">{error}</div>}
            {loading && <div className="loading-state">Loading company coverage…</div>}
            {!loading && company && (
                <section className="article-panel">
                    <div className="panel-heading">
                        <div>
                            <p className="eyebrow">Company coverage</p>
                            <h1>{company.name}</h1>
                            <p className="company-domain">{company.domain || 'Portfolio company'}</p>
                        </div>
                        <div className="window-badge"><span className="live-dot" />Rolling 90 days</div>
                    </div>
                    {articles.length === 0 && <div className="panel-empty">No completed sentiment coverage in this period.</div>}
                    <div className="article-list">
                        {articles.map((article) => (
                            <article className="article-card" key={article.id}>
                                <div className="article-card-topline">
                                    <span>{article.source || 'Unknown source'}</span>
                                    <span>{formatDate(article.published_at)}</span>
                                </div>
                                <h3>
                                    {isSafeExternalUrl(article.canonical_url)
                                        ? <a href={article.canonical_url} target="_blank" rel="noreferrer">{article.title}</a>
                                        : article.title}
                                </h3>
                                <div className="article-card-footer">
                                    <SentimentPill sentiment={article.sentiment} />
                                </div>
                            </article>
                        ))}
                    </div>
                </section>
            )}
        </main>
    );
}

function App() {
    const match = window.location.pathname.match(/^\/companies\/([^/]+)\/?$/);
    return match ? <CompanyPage companyId={decodeURIComponent(match[1])} /> : <DashboardPage />;
}

createRoot(document.getElementById('root')).render(
    <StrictMode><App /></StrictMode>,
);
