import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, addCompany } from "./support/news-test-db.js";

const fixture = createTestDatabase();
process.env.NEWS_DATABASE_PATH = fixture.path;
process.env.OLLAMA_URL = "http://test-ollama.local/api/chat";

const { main } = await import("../job/scripts/news-sentiment.js");

test("sentiment stores a high-confidence classification as completed", async (t) => {
  t.after(() => fixture.cleanup());
  addCompany(fixture.database, { name: "Acme" });
  fixture.database
    .prepare(`
      INSERT INTO articles
        (id, company_id, title, canonical_url, source, content, sentiment_status)
      VALUES (1, 1, 'Acme growth', 'https://publisher.example/acme', 'Publisher', ?, 'pending')
    `)
    .run("Acme reported strong customer growth and expanded its successful product line during the quarter.");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      message: {
        content: JSON.stringify({
          sentiment: "positive",
          sentiment_confidence: 0.91,
        }),
      },
    });

  try {
    await main();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const article = fixture.database
    .prepare("SELECT sentiment, sentiment_confidence, sentiment_status FROM articles WHERE id = 1")
    .get();
  assert.equal(article.sentiment, "positive");
  assert.equal(article.sentiment_confidence, 0.91);
  assert.equal(article.sentiment_status, "completed");
});
