// src/db.js
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH =
  process.env.DB_PATH || path.join(process.cwd(), "data.sqlite");

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  // If dir is "/", mkdirSync will throw; ignore
  if (!dir || dir === "/") return;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    // If you configured /var/data without a mounted disk, it will fail here.
    // Let it fail loudly so you fix the platform config.
    throw e;
  }
}

ensureDirForFile(DB_PATH);

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Base table (latest schema)
db.exec(`
CREATE TABLE IF NOT EXISTS articles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  category      TEXT,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL UNIQUE,
  source_name   TEXT,
  source_url    TEXT,
  source_domain TEXT,
  published_at  TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  summary       TEXT,
  summarized_at TEXT
);
`);

function hasColumn(table, col) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === col);
}

function addColumnIfMissing(table, col, type) {
  if (!hasColumn(table, col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type};`);
  }
}

// Migrations (prevents “no such column …” forever)
addColumnIfMissing("articles", "category", "TEXT");
addColumnIfMissing("articles", "source_name", "TEXT");
addColumnIfMissing("articles", "source_url", "TEXT");
addColumnIfMissing("articles", "source_domain", "TEXT");
addColumnIfMissing("articles", "published_at", "TEXT");
addColumnIfMissing("articles", "created_at", "TEXT");
addColumnIfMissing("articles", "summary", "TEXT");
addColumnIfMissing("articles", "summarized_at", "TEXT");

// Indexes
db.exec(`
CREATE INDEX IF NOT EXISTS idx_articles_summarized_at ON articles(summarized_at);
CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
`);

module.exports = { db, DB_PATH };