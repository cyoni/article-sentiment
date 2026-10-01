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
const recentCandidateDays = 3;
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

function isResolvedCandidate(candidate) {
  return (
    candidate?.canonical_url &&
    candidate?.rss_url &&
    candidate.canonical_url !== candidate.rss_url &&
    !isGoogleNewsUrl(candidate.canonical_url)
  );
}

function createCandidateWriter(database) {
  const recentCandidates = database.prepare(`
        SELECT id, canonical_url, rss_url
        FROM candidates
        WHERE company_id = ?
          AND rss_url IS NOT NULL
          AND datetime(COALESCE(published_at, created_at))
              >= datetime('now', '-' || ? || ' days')
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

  return {
    recentCandidates(companyId) {
      return recentCandidates.all(companyId, recentCandidateDays);
    },
    updateUnresolved(company, query, item, canonicalUrl) {
      update.run(
        company.id,
        item.title,
        canonicalUrl,
        item.source,
        query,
        item.publishedAt,
        0,
        item.id,
      );
    },
    insert(company, query, item, canonicalUrl, needsReview) {
      const result = insert.run(
        company.id,
        item.title,
        canonicalUrl,
        item.source || "Google News",
        query,
        item.rssUrl,
        item.publishedAt,
        needsReview ? 1 : 0,
      );
      return {
        id: Number(result.lastInsertRowid),
        rss_url: item.rssUrl,
        canonical_url: canonicalUrl,
      };
    },
  };
}

async function searchCompany(company, decoder, candidateWriter) {
  const { query, url } = buildFeedUrl(company.name);
  const feed = await fetchText(url);
  const items = parseItems(feed.text);
  const existingCandidates = candidateWriter.recentCandidates(company.id);
  const candidatesByRssUrl = new Map(
    existingCandidates.map((candidate) => [candidate.rss_url, candidate]),
  );
  const candidatesByCanonicalUrl = new Map(
    existingCandidates.map((candidate) => [candidate.canonical_url, candidate]),
  );
  let inserted = 0;
  let needsReview = 0;

  for (const item of items) {
    const existingCandidate = candidatesByRssUrl.get(item.rssUrl);
    if (isResolvedCandidate(existingCandidate)) {
      console.log(
        `[search] skip resolved candidate=${existingCandidate.id} company=${company.name} title=${JSON.stringify(item.title)}`,
      );
      continue;
    }

    let canonicalUrl = item.rssUrl;
    let unresolved = false;
    try {
      canonicalUrl =
        (await resolveArticleUrl(decoder, item.rssUrl)) ?? item.rssUrl;
      unresolved =
        isGoogleNewsUrl(item.rssUrl) &&
        (canonicalUrl === item.rssUrl || isGoogleNewsUrl(canonicalUrl));
    } catch {
      unresolved = true;
    }
    if (unresolved) {
      needsReview += 1;
      if (!existingCandidate) {
        const candidate = candidateWriter.insert(
          company,
          query,
          item,
          canonicalUrl,
          true,
        );
        candidatesByRssUrl.set(candidate.rss_url, candidate);
        candidatesByCanonicalUrl.set(candidate.canonical_url, candidate);
        inserted += 1;
      }
      continue;
    }

    const existingCanonical = candidatesByCanonicalUrl.get(canonicalUrl);
    if (existingCanonical && existingCanonical.id !== existingCandidate?.id)
      continue;

    if (existingCandidate) {
      candidateWriter.updateUnresolved(
        company,
        query,
        { ...item, id: existingCandidate.id },
        canonicalUrl,
      );
      const updatedCandidate = {
        ...existingCandidate,
        canonical_url: canonicalUrl,
      };
      candidatesByRssUrl.set(updatedCandidate.rss_url, updatedCandidate);
      candidatesByCanonicalUrl.set(canonicalUrl, updatedCandidate);
      continue;
    }

    const candidate = candidateWriter.insert(
      company,
      query,
      item,
      canonicalUrl,
      false,
    );
    candidatesByRssUrl.set(candidate.rss_url, candidate);
    candidatesByCanonicalUrl.set(candidate.canonical_url, candidate);
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
  const candidateWriter = createCandidateWriter(database);
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
          const result = await searchCompany(company, decoder, candidateWriter);
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
