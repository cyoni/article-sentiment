import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, addCompany } from "./support/news-test-db.js";

const fixture = createTestDatabase();
process.env.NEWS_DATABASE_PATH = fixture.path;

const { main } = await import("../job/scripts/news-search.js");

test("search stores the Google RSS pubDate on a new candidate", async (t) => {
  t.after(() => fixture.cleanup());
  addCompany(fixture.database, { name: "Acme" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `<?xml version="1.0"?><rss><channel><item>
        <title>Acme launches a product</title>
        <link>https://publisher.example/acme-launch</link>
        <source>Publisher</source>
        <pubDate>Wed, 01 Oct 2026 12:34:56 GMT</pubDate>
      </item></channel></rss>`,
      { headers: { "content-type": "application/xml" } },
    );

  try {
    await main();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const candidate = fixture.database
    .prepare("SELECT title, published_at FROM candidates")
    .get();
  assert.equal(candidate.title, "Acme launches a product");
  assert.equal(candidate.published_at, "2026-10-01T12:34:56.000Z");
});
