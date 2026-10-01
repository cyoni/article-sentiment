import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  companyContextJson,
  normalizeIsoDate,
  truncate,
} from "../lib/news-utils.js";
import {
  delay,
  isRetryableOllamaError,
  retryableOllamaError,
} from "../lib/ollama-utils.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databasePath =
  process.env.NEWS_DATABASE_PATH ?? join(projectRoot, "data", "ourcrowd.db");
const promptTemplate = readFileSync(
  join(projectRoot, "prompts", "news-sentiment.txt"),
  "utf8",
);
const ollamaUrl = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434/api/chat";
const model = process.env.OLLAMA_MODEL ?? "qwen3.5:9b";
const promptVersion = "news-sentiment-v4";
const minimumConfidence = 0.7;
const contentLimit = 8_000;
const requestTimeoutMs = 90_000;
const ollamaMaxAttempts = 2;
const ollamaRetryDelayMs = 1_000;

const sentimentSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sentiment", "sentiment_confidence"],
  properties: {
    sentiment: { type: "string", enum: ["positive", "negative", "neutral"] },
    sentiment_confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
  },
};

function buildPrompt(article, company) {
  const values = {
    TARGET_COMPANY_JSON: companyContextJson(company),
    ARTICLE_JSON: JSON.stringify(
      {
        company: company.name,
        title: article.title,
        candidate_url: article.canonical_url,
        source: article.source,
        published_at: normalizeIsoDate(article.published_at),
        content: truncate(article.content, contentLimit),
      },
      null,
      2,
    ),
  };
  return promptTemplate.replace(
    /\{\{([A-Z_]+)\}\}/g,
    (_, key) => values[key] ?? "",
  );
}

async function callOllamaOnce(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  const request = {
    model,
    think: false,
    stream: false,
    format: sentimentSchema,
    options: { temperature: 0 },
    messages: [
      {
        role: "system",
        content:
          "You are a careful sentiment classifier. Follow the requested JSON schema exactly.",
      },
      { role: "user", content: prompt },
    ],
  };

  try {
    const response = await fetch(ollamaUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    if (!response.ok) {
      const responseText = await response.text();
      const error = new Error(
        `Ollama HTTP ${response.status}: ${responseText}`,
      );
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw retryableOllamaError("Ollama returned invalid response JSON");
    }
    const responseText = payload.message?.content ?? "";
    if (!responseText.trim()) {
      throw retryableOllamaError("Ollama returned an empty response");
    }
    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      throw retryableOllamaError(
        "Ollama returned invalid sentiment JSON",
        responseText,
      );
    }
    if (
      !["positive", "negative", "neutral"].includes(result.sentiment) ||
      !Number.isFinite(result.sentiment_confidence) ||
      result.sentiment_confidence < 0 ||
      result.sentiment_confidence > 1
    ) {
      throw retryableOllamaError(
        "Ollama returned an invalid sentiment object",
        responseText,
      );
    }
    return { request, responseText, result };
  } finally {
    clearTimeout(timeout);
  }
}

async function callOllama(prompt) {
  let lastError;
  for (let attempt = 1; attempt <= ollamaMaxAttempts; attempt += 1) {
    try {
      return await callOllamaOnce(prompt);
    } catch (error) {
      lastError = error;
      if (attempt === ollamaMaxAttempts || !isRetryableOllamaError(error)) {
        throw error;
      }
      console.warn(
        `[sentiment] attempt ${attempt} failed; retrying once: ${error.message}`,
      );
      await delay(ollamaRetryDelayMs);
    }
  }
  throw lastError;
}

function createLogWriter(database) {
  const insert = database.prepare(`
        INSERT INTO llm_logs
            (article_id, operation, model, prompt_version, request_json,
             response_text, result_json, status, error_message, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

  return (log) =>
    insert.run(
      log.articleId,
      "news_sentiment",
      model,
      promptVersion,
      log.requestJson ?? null,
      log.responseText ?? null,
      log.resultJson ?? null,
      log.status,
      log.errorMessage ?? null,
      log.durationMs ?? null,
    );
}

async function classifyArticle(article, company, statements, writeLog) {
  if (!article.content || article.content.trim().length < 80) {
    statements.markReview.run(new Date().toISOString(), article.id);
    writeLog({
      articleId: article.id,
      status: "skipped",
      errorMessage: "content_empty_or_too_short",
    });
    return "needs_review";
  }

  const prompt = buildPrompt(article, company);
  const startedAt = Date.now();
  let result;
  let call;
  try {
    call = await callOllama(prompt);
    result = call.result;
  } catch (error) {
    statements.markError.run(article.id);
    writeLog({
      articleId: article.id,
      requestJson: JSON.stringify({ model, promptVersion, prompt }),
      responseText: call?.responseText ?? error.responseText,
      status: "error",
      errorMessage: error.message,
      durationMs: Date.now() - startedAt,
    });
    return "error";
  }

  const status =
    result.sentiment_confidence < minimumConfidence
      ? "needs_review"
      : "completed";
  const sentimentAt = new Date().toISOString();
  statements.saveSentiment.run(
    result.sentiment,
    result.sentiment_confidence,
    status,
    sentimentAt,
    article.id,
  );
  writeLog({
    articleId: article.id,
    requestJson: JSON.stringify({ model, promptVersion, prompt }),
    responseText: call.responseText,
    resultJson: JSON.stringify(result),
    status: "success",
    durationMs: Date.now() - startedAt,
  });
  return status;
}

async function main() {
  const database = new DatabaseSync(databasePath);
  const statements = {
    articles: database.prepare(`
            SELECT a.id, a.company_id, a.title, a.canonical_url, a.source, a.published_at, a.content
            FROM articles a
            WHERE a.sentiment IS NULL AND a.sentiment_status IN ('pending', 'error')
            ORDER BY a.id
            LIMIT ?
        `),
    company: database.prepare(
      "SELECT id, name, domain, sector, description FROM companies WHERE id = ?",
    ),
    saveSentiment: database.prepare(`
            UPDATE articles
            SET sentiment = ?, sentiment_confidence = ?, sentiment_status = ?, sentiment_at = ?, updated_at = datetime('now')
            WHERE id = ?
        `),
    markReview: database.prepare(`
            UPDATE articles
            SET sentiment_status = 'needs_review', sentiment_at = ?, updated_at = datetime('now')
            WHERE id = ?
        `),
    markError: database.prepare(`
            UPDATE articles
            SET sentiment_status = 'error', updated_at = datetime('now')
            WHERE id = ?
        `),
  };
  const writeLog = createLogWriter(database);
  const limit = Number.parseInt(process.env.NEWS_SENTIMENT_LIMIT ?? "0", 10);
  const articles = statements.articles.all(limit > 0 ? limit : -1);
  const totals = {
    articles: articles.length,
    completed: 0,
    needsReview: 0,
    errors: 0,
  };

  try {
    for (const article of articles) {
      const company = statements.company.get(article.company_id);
      if (!company) {
        statements.markError.run(article.id);
        totals.errors += 1;
        continue;
      }
      const status = await classifyArticle(
        article,
        company,
        statements,
        writeLog,
      );
      if (status === "completed") totals.completed += 1;
      else if (status === "needs_review") totals.needsReview += 1;
      else totals.errors += 1;
      console.log(`${article.id}: ${company.name} -> ${status}`);
    }
  } finally {
    database.close();
  }

  console.log(JSON.stringify({ model, ...totals }, null, 2));
}

export { main };

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
