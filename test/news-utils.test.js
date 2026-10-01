import assert from "node:assert/strict";
import test from "node:test";
import {
  asArray,
  assertSafeArticleUrl,
  fetchWithTimeout,
  isGoogleNewsUrl,
  isSafeArticleUrl,
  mapWithConcurrency,
  normalizeIsoDate,
  normalizeUrl,
  textValue,
  truncate,
} from "../job/lib/news-utils.js";

test("normalizes common RSS values", () => {
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray("item"), ["item"]);
  assert.equal(textValue({ "#text": "  source  " }), "source");
  assert.equal(normalizeIsoDate("not a date"), null);
  assert.equal(
    normalizeIsoDate("2026-10-01T12:00:00Z"),
    "2026-10-01T12:00:00.000Z",
  );
  assert.equal(truncate("  abcdef  ", 3), "abc\n[truncated]");
});

test("normalizes publisher URLs without removing meaningful query parameters", () => {
  assert.equal(
    normalizeUrl("https://Example.com/story/?utm_source=newsletter&id=42#section"),
    "https://example.com/story?id=42",
  );
  assert.equal(isGoogleNewsUrl("https://news.google.com/rss/articles/example"), true);
  assert.equal(isGoogleNewsUrl("https://publisher.example/article"), false);
  assert.equal(isGoogleNewsUrl("not a URL"), true);
  assert.equal(isSafeArticleUrl("https://publisher.example/article"), true);
  assert.equal(isSafeArticleUrl("javascript:alert(1)"), false);
  assert.equal(isSafeArticleUrl("file:///etc/passwd"), false);
  assert.equal(isSafeArticleUrl("http://127.0.0.1:3000/"), true);
  assert.throws(() => normalizeUrl("https://user:pass@publisher.example/article"));
});

test("rejects article URLs that target local services", async () => {
  await assert.rejects(
    assertSafeArticleUrl("http://127.0.0.1:3000/internal"),
    /private IP address/,
  );
  await assert.rejects(
    assertSafeArticleUrl("http://localhost:3000/internal"),
    /local host/,
  );
});

test("limits concurrent work while preserving input order", async () => {
  let active = 0;
  let maximumActive = 0;
  const results = await mapWithConcurrency(
    [1, 2, 3, 4],
    async (value) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return value * 2;
    },
    2,
  );

  assert.deepEqual(results, [2, 4, 6, 8]);
  assert.equal(maximumActive, 2);
});

test("aborts a hanging request at the configured timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        },
        { once: true },
      );
    });

  try {
    await assert.rejects(fetchWithTimeout("https://example.invalid", {}, 10), {
      name: "AbortError",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
