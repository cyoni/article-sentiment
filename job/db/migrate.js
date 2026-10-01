import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDirectory = join(projectRoot, 'data');
const migrationsDirectory = join(projectRoot, 'migrations');
const databasePath = join(dataDirectory, 'ourcrowd.db');

mkdirSync(dataDirectory, { recursive: true });

const database = new DatabaseSync(databasePath);

database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
`);

const appliedMigrations = new Set(
    database
        .prepare('SELECT filename FROM schema_migrations')
        .all()
        .map(({ filename }) => filename),
);

const migrationFiles = readdirSync(migrationsDirectory)
    .filter((filename) => /^\d+_.+\.sql$/.test(filename))
    .sort();

const recordMigration = database.prepare(
    'INSERT INTO schema_migrations (filename) VALUES (?)',
);

for (const filename of migrationFiles) {
    if (appliedMigrations.has(filename)) {
        continue;
    }

    const migrationPath = join(migrationsDirectory, filename);
    const migrationSql = readFileSync(migrationPath, 'utf8');

    database.exec('BEGIN');
    try {
        database.exec(migrationSql);
        recordMigration.run(filename);
        database.exec('COMMIT');
        console.log(`Applied migration: ${filename}`);
    } catch (error) {
        database.exec('ROLLBACK');
        throw error;
    }
}

database.close();
console.log(`Database ready: ${databasePath}`);
