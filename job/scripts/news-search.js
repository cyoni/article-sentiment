import { DatabaseSync } from "node:sqlite";
import { XMLParser } from "fast-xml-parser";
import { createRequire } from "node:module";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asArray,
  isGoogleNewsUrl,
  mapWithConcurrency,
  normalizeIsoDate,
  normalizeUrl,
  textValue,
} from "../lib/news-utils.js";

const require = createRequire(import.meta.url);
const { GoogleDecoder } = require("google-news-url-decoder");

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databasePath =
  process.env.NEWS_DATABASE_PATH ?? join(projectRoot, "data", "ourcrowd.db");
const concurrency = 2;
const decoderMaxAttempts = 4;
const decoderRetryDelaysMs = [1_000, 3_000, 7_000];
const requestTimeoutMs = 20_000;
const rssParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

function buildFeedUrl(companyName) {
  const query = `"${companyName}" company when:2d`;
  return {
    query,
    url: `https://news.google.com/rss/search?${new URLSearchParams({
      q: query,
      hl: "en-US",
      gl: "US",
      ceid: "US:en",
    })}`,
  };
}

function parseItems(xml) {
  const parsed = rssParser.parse(xml);
  return asArray(parsed?.rss?.channel?.item)
    .map((item) => ({
      title: textValue(item.title),
      rssUrl: textValue(item.link),
      source: textValue(item.source?.["#text"] ?? item.source),
      publishedAt: normalizeIsoDate(textValue(item.pubDate)),
      description: textValue(item.description),
    }))
    .filter((item) => item.title && item.rssUrl);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { text: await response.text(), finalUrl: response.url };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveArticleUrl(decoder, rssUrl) {
  if (!isGoogleNewsUrl(rssUrl)) {
    return normalizeUrl(rssUrl);
  }

  for (let attempt = 1; attempt <= decoderMaxAttempts; attempt += 1) {
    try {
      const result = await decoder.decode(rssUrl);
      if (
        !result?.status ||
        !result.decoded_url ||
        isGoogleNewsUrl(result.decoded_url)
      ) {
        throw new Error(
          result?.message || "Google News URL could not be decoded",
        );
      }

      return normalizeUrl(result.decoded_url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rateLimited = /\b429\b|too many requests|rate limit/i.test(message);
      if (!rateLimited || attempt === decoderMaxAttempts) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, decoderRetryDelaysMs[attempt - 1]),
      );
    }
  }

  throw new Error("Google News URL could not be decoded");
}

function createCandidateWriter(database) {
  const findByUrl = database.prepare(`
        SELECT id, canonical_url, rss_url
        FROM candidates
        WHERE company_id = ?
          AND (canonical_url = ? OR rss_url = ?)
        LIMIT 1
    `);
  const update = database.prepare(`
        UPDATE candidates
        SET company_id = ?, title = ?, canonical_url = ?, source = ?, query = ?, published_at = ?,
            status = 'pending', needs_review = ?, updated_at = datetime('now')
        WHERE id = ?
    `);
  const insert = database.prepare(`
        INSERT INTO candidates
            (company_id, title, canonical_url, source, query, status, rss_url, published_at, needs_review)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `);

  return (company, query, item, canonicalUrl, needsReview) => {
    const existing = findByUrl.get(company.id, canonicalUrl, item.rssUrl);
    if (existing) {
      if (
        existing.rss_url === item.rssUrl &&
        existing.canonical_url === item.rssUrl &&
        !needsReview
      ) {
        update.run(
          company.id,
          item.title,
          canonicalUrl,
          item.source,
          query,
          item.publishedAt,
          0,
          existing.id,
        );
      }
      return false;
    }

    insert.run(
      company.id,
      item.title,
      canonicalUrl,
      item.source || "Google News",
      query,
      item.rssUrl,
      item.publishedAt,
      needsReview ? 1 : 0,
    );
    return true;
  };
}

async function searchCompany(company, decoder, database) {
  const { query, url } = buildFeedUrl(company.name);
  const feed = await fetchText(url);
  const items = parseItems(feed.text);
  const writeCandidate = createCandidateWriter(database);
  let inserted = 0;
  let needsReview = 0;

  for (const item of items) {
    let canonicalUrl = item.rssUrl;
    let unresolved = false;
    try {
      canonicalUrl =
        (await resolveArticleUrl(decoder, item.rssUrl)) ?? item.rssUrl;
      unresolved =
        canonicalUrl === item.rssUrl || isGoogleNewsUrl(canonicalUrl);
    } catch {
      unresolved = true;
    }
    if (unresolved) needsReview += 1;
    if (writeCandidate(company, query, item, canonicalUrl, unresolved))
      inserted += 1;
  }

  return { company: company.name, items: items.length, inserted, needsReview };
}

async function main() {
  const database = new DatabaseSync(databasePath);
  const companies = database
    .prepare("SELECT id, name FROM companies WHERE is_active = 1 ORDER BY id")
    .all();
  const decoder = new GoogleDecoder();
  const totals = {
    companies: companies.length,
    items: 0,
    inserted: 0,
    needsReview: 0,
    failed: 0,
  };

  try {
    const results = await mapWithConcurrency(
      companies,
      async (company) => {
        try {
          const result = await searchCompany(company, decoder, database);
          console.log(
            `${result.company}: ${result.items} items, ${result.inserted} new, ${result.needsReview} needs review`,
          );
          return result;
        } catch (error) {
          console.error(`${company.name}: failed - ${error.message}`);
          return {
            company: company.name,
            items: 0,
            inserted: 0,
            needsReview: 0,
            failed: 1,
          };
        }
      },
      concurrency,
    );

    for (const result of results) {
      totals.items += result.items;
      totals.inserted += result.inserted ?? 0;
      totals.needsReview += result.needsReview ?? 0;
      totals.failed += result.failed ?? 0;
    }
  } finally {
    database.close();
  }

  console.log(JSON.stringify(totals, null, 2));
  if (totals.failed > 0) process.exitCode = 1;
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
