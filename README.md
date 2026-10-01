# Press Monitor

This project monitors recent news articles for tracked companies, verifies the articles and sends a daily alert.

## What it does

- Finds recent Google News RSS results for active companies
- Resolves Google News links to publisher URLs
- Verifies company relevance before checking for duplicate events
- Classifies approved articles as positive, negative, or neutral
- Sends uncertain or failed cases to manual review
- Creates a daily email digest of newly classified articles
- Shows completed coverage from the last 90 days in the dashboard

## Requirements

- Node.js 22.5 or newer
- Ollama, with `qwen3.5:9b` available locally

## Run the project

```bash
npm install
ollama run qwen3.5:9b --think=false
```

The local database is `job/data/ourcrowd.db`. If it is missing, create it and seed the companies:

```bash
npm run db:migrate
npm run db:seed
```

The default seed file is `job/data/seed/ourcrowd_companies.txt`. If it is in a different location, set `OURCROWD_COMPANIES_FILE` before running the seed job.

Start the dashboard:

```bash
npm run ui:dev
```

Open `http://localhost:5173`.
Run the full pipeline:

`npm run news:pipeline`

## Configuration

Email alerts are optional. Set these variables to enable them:

```bash
AISEND_API_KEY=...
ALERT_RECIPIENT_EMAIL=you@example.com
AISEND_FROM_EMAIL=sender@example.com
```

## Pipeline

### 1. News search

The search job queries Google News RSS using `"{company name}" company when:2d`. The original RSS URL is stored in `rss_url`. The RSS does not show the news source url, so we use a library to resolve the publisher URL, and it is stored in `canonical_url`.

Search check for duplicates based on the url URL before inserting candidates. If a Google News URL cannot be resolved, the candidate stays in the database with `needs_review = 1` rather than being passed to the verifier.

Limitations:

1. Sometimes Google blocks requests with too-many-requests code. I tried to minimize the concurrent requests to 2, which helps, but Google can rate limit us anyway.

2. The verification step needs the article's content before passing it to the LLM. The issue is some news sources use client side rendering, or use paywall or block bots, so I preferred to skip those articles because we can't reliabily rely only on titles when we classify.

### 2. Verification

Verification is intentionally split into two LLM calls:

1. [news-company-match.txt](job/prompts/news-company-match.txt) decides whether the candidate is mainly about the tracked company.
2. [news-duplicate-check.txt](job/prompts/news-duplicate-check.txt) runs only for relevant candidates and checks whether the candidate covers the same concrete event as a recent approved article.

Before verification, the job fetches the publisher page again and removes common page noise such as navigation, ads, newsletter blocks, and related-content sections. It compares against up to five approved articles from the last seven days.

`same_event` means duplicate coverage of the same concrete event. `related_topic` means a similar subject but a separate event. `different` means there is no meaningful event relationship. `not_applicable` is used when there are no approved articles to compare.

Company-match and duplicate confidence must be at least `0.80`. Content fetches retry once after a short delay for timeouts, network errors, HTTP `408`, HTTP `429`, and `5xx` responses; HTTP `403` is sent directly to manual review. Transient Ollama failures, empty replies, and invalid JSON or schema results are also retried once. Missing content, a second failed attempt, contradictory results, or low confidence go to manual review. Successful new coverage is inserted into `articles`; model calls and errors are recorded in `llm_logs`.

### 3. Sentiment

[news-sentiment.txt](job/prompts/news-sentiment.txt) classifies approved articles as `positive`, `negative`, or `neutral`. The sentiment threshold is `0.70`; lower-confidence results receive `sentiment_status = 'needs_review'`.

The sentiment job retries Ollama failures, empty replies, and invalid JSON or schema results once. It also re-attempts articles with `sentiment_status = 'error'` on later runs. It does not overwrite completed sentiment.

### 4. Alerts

The alert job groups newly completed articles into one AISEND digest per UTC day. It stores alert state and linked articles in `alerts` and `alert_articles`, so a successfully sent digest is not sent again. The digest groups articles by sentiment and includes the publisher link and confidence score.

## Data model

- `companies` — tracked companies and their metadata
- `candidates` — discovered articles before relevance/duplicate verification
- `articles` — approved coverage and sentiment results
- `llm_logs` — prompts, responses, errors, and durations for LLM calls
- `alerts` and `alert_articles` — daily digest delivery and article membership

Candidate `status` values are `pending`, `relevant`, and `not_relevant`. Candidates also use `needs_review` for cases requiring a person to decide. Article `sentiment_status` values are `pending`, `completed`, `needs_review`, and `error`.

## Dashboard

The dashboard includes every active company, including companies with no recent coverage. It shows only articles with completed sentiment from the rolling 90-day window. Company pages link to the original publisher articles.

## Architecture notes

1. AI coding assistent chat: https://chatgpt.com/s/cx_6abe2d439cc08191a16c1a5023230c93

2. I tried news APIs such as NewsAPI and GNews, but they did not provide enough coverage for smaller startups. Google News RSS gave better results and allowed me to search a recent time window. The tradeoff is that Google News links must be decoded before the publisher content can be fetched, and some publishers still return HTTP 403 or HTTP 429.

3. I chose SQLite because it is simple and fits this assignment. For a production system I would use PostgreSQL.

4. I tested Llama 3.1:8b and Qwen 3.5:9b against company matching, duplicate detection, sentiment, confidence, and response time. Qwen was a little slower, but it gave me more reliable results, so I chose it. The model uses structured JSON, temperature 0, and thinking disabled. That makes the process more consistent, but uncertain cases still go to manual review instead of being forced into a classification.
