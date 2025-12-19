// src/db.js
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, "..", "data.sqlite");

// Ensure directory exists (important if DB_PATH is /var/data/...)
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Recommended pragmas for production-ish usage
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Create base table if missing (latest schema)
db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    url TEXT UNIQUE,
    source_name TEXT,
    source_domain TEXT,
    summary TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    summarized_at TEXT
  );
`);

function ensureColumn(table, colName, colType) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === colName);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colType};`);
  }
}

// Migrations: add any columns your code expects
ensureColumn("articles", "source_name", "TEXT");
ensureColumn("articles", "source_domain", "TEXT");
ensureColumn("articles", "summary", "TEXT");
ensureColumn("articles", "created_at", "TEXT");
ensureColumn("articles", "summarized_at", "TEXT");

module.exports = db;