const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH =
  process.env.DB_PATH ||
  path.join(process.cwd(), "data.sqlite");

const dir = path.dirname(DB_PATH);
fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  source_name TEXT,
  source_domain TEXT,
  source_url TEXT,
  category TEXT,
  published_at TEXT,
  summary TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  summarized_at TEXT
);
`);

function ensureColumn(table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === col);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type};`);
  }
}

ensureColumn("articles", "source_name", "TEXT");
ensureColumn("articles", "source_domain", "TEXT");
ensureColumn("articles", "source_url", "TEXT");
ensureColumn("articles", "category", "TEXT");
ensureColumn("articles", "published_at", "TEXT");
ensureColumn("articles", "summary", "TEXT");
ensureColumn("articles", "summarized_at", "TEXT");

module.exports = db;