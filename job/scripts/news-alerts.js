import { DatabaseSync } from "node:sqlite";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithTimeout } from "../lib/news-utils.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databasePath =
  process.env.NEWS_DATABASE_PATH ?? join(projectRoot, "data", "ourcrowd.db");
const aisendUrl =
  process.env.AISEND_URL ?? "https://api.aisend.app/api/v1/emails";
const aisendApiKey = process.env.AISEND_API_KEY;
const recipientEmail = process.env.ALERT_RECIPIENT_EMAIL;
const senderEmail = process.env.AISEND_FROM_EMAIL ?? "onboarding@aisend.app";
const dryRun = process.env.NEWS_ALERT_DRY_RUN === "1";
const emailRequestTimeoutMs = 30_000;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(value) {
  if (!value) return "Unknown publication date";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toISOString().slice(0, 10);
}

function buildSubject(articles) {
  return `OurCrowd news digest — ${articles.length} new sentiment${articles.length === 1 ? "" : "s"}`;
}

function buildBodies(articles, alertDate) {
  const groups = new Map([
    ["positive", []],
    ["negative", []],
    ["neutral", []],
  ]);
  for (const article of articles) groups.get(article.sentiment).push(article);

  const textLines = [`OurCrowd news digest for ${alertDate}`, ""];
  const htmlSections = [
    `<h1>OurCrowd news digest for ${escapeHtml(alertDate)}</h1>`,
  ];
  for (const sentiment of ["positive", "negative", "neutral"]) {
    const group = groups.get(sentiment);
    if (group.length === 0) continue;
    textLines.push(`${sentiment.toUpperCase()} (${group.length})`);
    htmlSections.push(
      `<h2>${escapeHtml(sentiment.toUpperCase())} (${group.length})</h2><ul>`,
    );
    for (const article of group) {
      const label = `${article.company}: ${article.title}`;
      const metadata = `${article.source} · ${formatDate(article.published_at)} · confidence ${article.sentiment_confidence}`;
      textLines.push(`- ${label}`);
      textLines.push(`  ${metadata}`);
      textLines.push(`  ${article.canonical_url}`);
      htmlSections.push(
        `<li><a href="${escapeHtml(article.canonical_url)}">${escapeHtml(label)}</a><br><small>${escapeHtml(metadata)}</small></li>`,
      );
    }
    textLines.push("");
    htmlSections.push("</ul>");
  }
  return { text: textLines.join("\n").trim(), html: htmlSections.join("\n") };
}

async function sendEmail(alert) {
  if (!aisendApiKey) throw new Error("AISEND_API_KEY is not configured");
  if (!recipientEmail)
    throw new Error("ALERT_RECIPIENT_EMAIL is not configured");

  const response = await fetchWithTimeout(
    aisendUrl,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aisendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": alert.idempotency_key,
      },
      body: JSON.stringify({
        from: senderEmail,
        to: recipientEmail,
        subject: alert.subject,
        text: alert.body_text,
        html: alert.body_html,
      }),
    },
    emailRequestTimeoutMs,
  );
  const responseText = await response.text();
  let payload;
  try {
    payload = responseText ? JSON.parse(responseText) : {};
  } catch {
    payload = {};
  }
  if (!response.ok)
    throw new Error(`AISend HTTP ${response.status}: ${responseText}`);
  return payload;
}

function createAlertSnapshot(database, statements, alertDate, articles) {
  const subject = buildSubject(articles);
  const bodies = buildBodies(articles, alertDate);
  const idempotencyKey = `ourcrowd-news-${alertDate}`;

  database.exec("BEGIN IMMEDIATE");
  try {
    // Another pipeline may have created today's snapshot after our first read.
    const existing = statements.alertByDate.get(alertDate);
    if (existing) {
      database.exec("COMMIT");
      return { alert: existing, created: false };
    }

    const alertId = statements.insertAlert.run(
      alertDate,
      articles.length,
      subject,
      bodies.text,
      bodies.html,
      idempotencyKey,
    ).lastInsertRowid;
    for (const article of articles) {
      statements.linkArticle.run(alertId, article.id);
    }

    const alert = statements.alertByDate.get(alertDate);
    database.exec("COMMIT");
    return { alert, created: true };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function main() {
  const database = new DatabaseSync(databasePath);
  const statements = {
    pendingArticles: database.prepare(`
            SELECT a.id, c.name company, a.title, a.canonical_url, a.source,
                   a.published_at, a.sentiment, a.sentiment_confidence
            FROM articles a
            JOIN companies c ON c.id = a.company_id
            WHERE a.sentiment_status = 'completed'
              AND NOT EXISTS (
                  SELECT 1 FROM alert_articles aa WHERE aa.article_id = a.id
              )
            ORDER BY a.sentiment_at, a.id
        `),
    alertByDate: database.prepare("SELECT * FROM alerts WHERE alert_date = ?"),
    insertAlert: database.prepare(`
            INSERT INTO alerts
                (alert_date, status, article_count, subject, body_text, body_html, idempotency_key)
            VALUES (?, 'sending', ?, ?, ?, ?, ?)
        `),
    linkArticle: database.prepare(
      "INSERT INTO alert_articles (alert_id, article_id) VALUES (?, ?)",
    ),
    markSent: database.prepare(`
            UPDATE alerts
            SET status = 'sent', provider_message_id = ?, sent_at = ?, error_message = NULL
            WHERE id = ?
        `),
    markFailed: database.prepare(`
            UPDATE alerts
            SET status = 'failed', error_message = ?
            WHERE id = ?
        `),
  };

  try {
    const alertDate = new Date().toISOString().slice(0, 10);
    let alert = statements.alertByDate.get(alertDate);

    if (alert?.status === "sent") {
      console.log(
        JSON.stringify(
          { articles: 0, status: "already_sent", alertDate },
          null,
          2,
        ),
      );
      return;
    }

    if (!alert) {
      const articles = statements.pendingArticles.all();
      if (articles.length === 0) {
        console.log(
          JSON.stringify({ articles: 0, status: "nothing_to_send" }, null, 2),
        );
        return;
      }

      if (dryRun) {
        const subject = buildSubject(articles);
        const bodies = buildBodies(articles, alertDate);
        console.log(
          JSON.stringify(
            {
              alertDate,
              articles: articles.length,
              status: "dry_run",
              subject,
              bodyText: bodies.text,
            },
            null,
            2,
          ),
        );
        return;
      }

      const snapshot = createAlertSnapshot(
        database,
        statements,
        alertDate,
        articles,
      );
      alert = snapshot.alert;
      if (alert.status === "sent") {
        console.log(
          JSON.stringify(
            { articles: 0, status: "already_sent", alertDate },
            null,
            2,
          ),
        );
        return;
      }
    }

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            alertId: alert.id,
            alertDate,
            articles: alert.article_count,
            status: "dry_run_retry",
            subject: alert.subject,
            bodyText: alert.body_text,
          },
          null,
          2,
        ),
      );
      return;
    }

    const payload = await sendEmail(alert);
    statements.markSent.run(
      payload.id ?? null,
      new Date().toISOString(),
      alert.id,
    );
    console.log(
      JSON.stringify(
        {
          alertId: alert.id,
          alertDate,
          articles: alert.article_count,
          status: "sent",
          providerMessageId: payload.id ?? null,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const alertDate = new Date().toISOString().slice(0, 10);
    const alert = statements.alertByDate.get(alertDate);
    if (alert) statements.markFailed.run(error.message, alert.id);
    throw error;
  } finally {
    database.close();
  }
}

export { main };

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
