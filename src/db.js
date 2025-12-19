// src/db.js
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

let DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data.sqlite");

// On Render, DB_PATH should be /var/data/data.sqlite (disk mount).
// If the directory isn't writable, fall back to /tmp so the app stays up.
try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch (e) {
  const fallback = "/tmp/data.sqlite";
  console.error(`DB dir not writable for ${DB_PATH}. Falling back to ${fallback}`);
  DB_PATH = fallback;
  process.env.DB_PATH = fallback;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    url TEXT UNIQUE,
    source_name TEXT,
    source_domain TEXT,
    category TEXT,
    published_at TEXT,
    summary TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    summarized_at TEXT
  );
`);

function ensureColumn(table, colName, colType) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === colName);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colType};`);
}

// migrations (so older DBs won't crash)
ensureColumn("articles", "title", "TEXT");
ensureColumn("articles", "url", "TEXT");
ensureColumn("articles", "source_name", "TEXT");
ensureColumn("articles", "source_domain", "TEXT");
ensureColumn("articles", "category", "TEXT");
ensureColumn("articles", "published_at", "TEXT");
ensureColumn("articles", "summary", "TEXT");
ensureColumn("articles", "created_at", "TEXT");
ensureColumn("articles", "summarized_at", "TEXT");

module.exports = db;