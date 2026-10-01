import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function createTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "ourcrowd-news-test-"));
  const path = join(directory, "news.db");
  const database = new DatabaseSync(path);

  database.exec(`
    CREATE TABLE companies (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      sector TEXT,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE candidates (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      article_id INTEGER,
      title TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      source TEXT NOT NULL,
      query TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      needs_review INTEGER NOT NULL DEFAULT 0,
      rss_url TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE articles (
      id INTEGER PRIMARY KEY,
      company_id INTEGER NOT NULL,
      candidate_id INTEGER,
      title TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      source TEXT NOT NULL,
      published_at TEXT,
      content TEXT,
      sentiment TEXT,
      sentiment_confidence REAL,
      sentiment_status TEXT NOT NULL DEFAULT 'pending',
      sentiment_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE llm_logs (
      id INTEGER PRIMARY KEY,
      candidate_id INTEGER,
      article_id INTEGER,
      operation TEXT NOT NULL,
      model TEXT,
      prompt_version TEXT,
      request_json TEXT,
      response_text TEXT,
      result_json TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE alerts (
      id INTEGER PRIMARY KEY,
      alert_date TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      article_count INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      body_html TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      provider_message_id TEXT,
      sent_at TEXT,
      error_message TEXT
    );
    CREATE TABLE alert_articles (
      alert_id INTEGER NOT NULL,
      article_id INTEGER NOT NULL
    );
  `);

  return {
    database,
    path,
    cleanup() {
      database.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

export function addCompany(database, { id = 1, name = "Acme" } = {}) {
  database
    .prepare(
      "INSERT INTO companies (id, name, domain, sector, description, is_active) VALUES (?, ?, ?, ?, ?, 1)",
    )
    .run(id, name, "acme.example", "Technology", "Test company");
}
