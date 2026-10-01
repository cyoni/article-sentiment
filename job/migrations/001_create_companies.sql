CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    domain TEXT,
    sector TEXT,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    CONSTRAINT companies_name_unique UNIQUE (name),
    CONSTRAINT companies_domain_unique UNIQUE (domain)
);

CREATE TRIGGER IF NOT EXISTS companies_updated_at
AFTER UPDATE ON companies
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE companies
    SET updated_at = datetime('now')
    WHERE id = OLD.id;
END;
