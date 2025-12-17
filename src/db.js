const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || "data.sqlite";
const db = new Database(dbPath);

// Base schema (new installs)
db.exec(`
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  published_at TEXT,
  category TEXT,
  raw_text TEXT,
  summary TEXT,
  summarized_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
CREATE INDEX IF NOT EXISTS idx_articles_summarized_at ON articles(summarized_at);
`);

// Safe “migration” for older DBs (won’t crash if column already exists)
try { db.exec(`ALTER TABLE articles ADD COLUMN summarized_at TEXT;`); } catch (e) {}
try { db.exec(`ALTER TABLE articles ADD COLUMN updated_at TEXT;`); } catch (e) {}

module.exports = db;