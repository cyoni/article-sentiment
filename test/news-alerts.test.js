import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, addCompany } from "./support/news-test-db.js";

const fixture = createTestDatabase();
process.env.NEWS_DATABASE_PATH = fixture.path;
process.env.NEWS_ALERT_DRY_RUN = "1";

const { main } = await import("../job/scripts/news-alerts.js");

test("alerts include completed sentiment and do not create an alert in dry-run mode", async (t) => {
  t.after(() => fixture.cleanup());
  addCompany(fixture.database, { name: "Acme" });
  fixture.database
    .prepare(`
      INSERT INTO articles
        (id, company_id, title, canonical_url, source, published_at, sentiment, sentiment_confidence, sentiment_status, sentiment_at)
      VALUES (1, 1, 'Acme growth', 'https://publisher.example/acme', 'Publisher', '2026-10-01T12:00:00.000Z', 'positive', 0.91, 'completed', '2026-10-01T12:00:00.000Z')
    `)
    .run();

  const messages = [];
  const originalLog = console.log;
  console.log = (message) => messages.push(String(message));
  try {
    await main();
  } finally {
    console.log = originalLog;
  }

  const output = JSON.parse(messages.at(-1));
  assert.equal(output.status, "dry_run");
  assert.equal(output.articles, 1);
  assert.match(output.bodyText, /Acme: Acme growth/);
  assert.equal(fixture.database.prepare("SELECT COUNT(*) AS count FROM alerts").get().count, 0);
});
