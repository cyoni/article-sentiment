import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { fetchWithTimeout } from "../lib/news-utils.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databasePath = join(projectRoot, "data", "ourcrowd.db");
const seedFilePath =
  process.env.OURCROWD_COMPANIES_FILE ??
  join(projectRoot, "data", "seed", "ourcrowd_companies.txt");

const requestHeaders = {
  Accept: "text/html,application/json",
};
const requestTimeoutMs = 20_000;

function readCompanyNames(filePath) {
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((name) => name.trim())
    .map(normalizeCompanyName)
    .filter(Boolean);
}

function normalizeCompanyName(name) {
  return String(name)
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeExistingCompanyNames(database) {
  const companies = database.prepare("SELECT id, name FROM companies").all();
  const existingNames = new Set(companies.map((company) => company.name));
  const updateName = database.prepare(
    "UPDATE companies SET name = ? WHERE id = ?",
  );

  for (const company of companies) {
    const normalizedName = normalizeCompanyName(company.name);
    if (normalizedName === company.name || existingNames.has(normalizedName))
      continue;
    updateName.run(normalizedName, company.id);
    existingNames.delete(company.name);
    existingNames.add(normalizedName);
  }
}

function companySlug(name) {
  return name.toLocaleLowerCase("en-US").replace(/\s+/g, "-");
}

function companyPageUrl(slug) {
  return `https://ourcrowd.com/companies/${encodeURIComponent(slug)}`;
}

function companyApiUrl(slug) {
  return `https://papi.ourcrowd.com/api/companies/${encodeURIComponent(slug)}?noDuplicate=1`;
}

function stripHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDomain(website) {
  if (!website) {
    return null;
  }

  try {
    const url = new URL(
      website.startsWith("http") ? website : `https://${website}`,
    );
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetchWithTimeout(
    url,
    { headers: requestHeaders },
    requestTimeoutMs,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

async function fetchCompany(name) {
  const slug = companySlug(name);
  const pageUrl = companyPageUrl(slug);
  const pageResponse = await fetchWithTimeout(
    pageUrl,
    { headers: requestHeaders },
    requestTimeoutMs,
  );

  if (!pageResponse.ok) {
    throw new Error(`HTTP ${pageResponse.status} from ${pageUrl}`);
  }

  // The page exposes the same structured company record used to render it.
  const company = await fetchJson(companyApiUrl(slug));

  if (!company || !company.name) {
    throw new Error(`No company data returned for ${pageUrl}`);
  }

  return {
    name,
    domain: normalizeDomain(company.website),
    sector: company.sectorName?.trim() || null,
    description: stripHtml(company.brief),
  };
}

function seedCompany(database, company) {
  database
    .prepare(
      `
        INSERT INTO companies (name, domain, sector, description, is_active)
        VALUES (?, ?, ?, ?, 1)
        ON CONFLICT(name) DO UPDATE SET
            domain = excluded.domain,
            sector = excluded.sector,
            description = excluded.description,
            is_active = 1
    `,
    )
    .run(company.name, company.domain, company.sector, company.description);
}

async function main() {
  mkdirSync(join(projectRoot, "data"), { recursive: true });
  const database = new DatabaseSync(databasePath);
  const companyNames = readCompanyNames(seedFilePath);
  const results = { succeeded: 0, failed: 0 };

  try {
    const existingCompaniesTable = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'companies'",
      )
      .get();

    if (!existingCompaniesTable) {
      throw new Error(
        "The companies table does not exist. Run npm run db:migrate first.",
      );
    }

    normalizeExistingCompanyNames(database);

    for (const name of companyNames) {
      try {
        const company = await fetchCompany(name);
        seedCompany(database, company);
        results.succeeded += 1;
        console.log(`Seeded: ${name} (${company.domain ?? "no domain"})`);
      } catch (error) {
        results.failed += 1;
        console.error(`Failed: ${name} - ${error.message}`);
      }
    }
  } finally {
    database.close();
  }

  console.log(
    `Completed: ${results.succeeded} succeeded, ${results.failed} failed.`,
  );

  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
