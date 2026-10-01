import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, addCompany } from "./support/news-test-db.js";

const fixture = createTestDatabase();
process.env.NEWS_DATABASE_PATH = fixture.path;

const { main } = await import("../job/scripts/news-search.js");

test("search stores new candidates and skips decoding already resolved RSS URLs", async (t) => {
  t.after(() => fixture.cleanup());
  addCompany(fixture.database, { name: "Acme" });
  const existingRssUrl = "https://news.google.com/rss/articles/already-resolved";
  fixture.database
    .prepare(`
      INSERT INTO candidates
        (id, company_id, title, canonical_url, source, rss_url, published_at)
      VALUES (1, 1, 'Existing Acme article', 'https://publisher.example/existing',
              'Publisher', ?, ?)
  `)
    .run(existingRssUrl, new Date().toISOString());
  const originalFetch = globalThis.fetch;
  let decoderRequests = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/rss/search?")) {
      return new Response(
        `<?xml version="1.0"?><rss><channel>
          <item>
            <title>Existing Acme article</title>
            <link>${existingRssUrl}</link>
            <source>Publisher</source>
            <pubDate>Wed, 01 Oct 2026 12:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Acme launches a product</title>
            <link>https://publisher.example/acme-launch</link>
            <source>Publisher</source>
            <pubDate>Wed, 01 Oct 2026 12:34:56 GMT</pubDate>
          </item>
        </channel></rss>`,
        { headers: { "content-type": "application/xml" } },
      );
    }
    decoderRequests += 1;
    throw new Error(`Resolved RSS URL should not be decoded: ${url}`);
  };

  try {
    await main();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const candidate = fixture.database
    .prepare("SELECT title, published_at, needs_review FROM candidates WHERE id = 2")
    .get();
  assert.equal(
    fixture.database.prepare("SELECT COUNT(*) AS count FROM candidates").get().count,
    2,
  );
  assert.equal(decoderRequests, 0);
  assert.equal(candidate.title, "Acme launches a product");
  assert.equal(candidate.published_at, "2026-10-01T12:34:56.000Z");
  assert.equal(candidate.needs_review, 0);
});
