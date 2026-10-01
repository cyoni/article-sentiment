import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, addCompany } from "./support/news-test-db.js";

const fixture = createTestDatabase();
process.env.NEWS_DATABASE_PATH = fixture.path;
process.env.OLLAMA_URL = "http://test-ollama.local/api/chat";

const { main } = await import("../job/scripts/news-verify.js");

test("verification approves a matching article and creates an approved article", async (t) => {
  t.after(() => fixture.cleanup());
  addCompany(fixture.database, { name: "Acme" });
  fixture.database
    .prepare(`
      INSERT INTO candidates
        (id, company_id, title, canonical_url, source, status, needs_review, published_at)
      VALUES (1, 1, 'Acme launches product', 'https://93.184.216.34/acme', 'Publisher', 'pending', 0, '2026-10-01T12:00:00.000Z')
    `)
    .run();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).startsWith("https://93.184.216.34/")) {
      return new Response(
        "<article><p>Acme launched its new platform for customers after a successful product announcement with detailed availability information.</p></article>",
        { headers: { "content-type": "text/html" } },
      );
    }
    if (String(url).startsWith("http://test-ollama.local/")) {
      return Response.json({
        message: {
          content: JSON.stringify({
            company_match: "yes",
            company_match_confidence: 0.95,
            needs_review: false,
            reason: "Acme is the main subject.",
          }),
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    await main();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const candidate = fixture.database
    .prepare("SELECT status, needs_review, article_id FROM candidates WHERE id = 1")
    .get();
  const article = fixture.database
    .prepare("SELECT title, published_at, content FROM articles WHERE candidate_id = 1")
    .get();
  assert.equal(candidate.status, "relevant");
  assert.equal(candidate.needs_review, 0);
  assert.ok(candidate.article_id);
  assert.equal(article.title, "Acme launches product");
  assert.equal(article.published_at, "2026-10-01T12:00:00.000Z");
  assert.match(article.content, /Acme launched/);
});
