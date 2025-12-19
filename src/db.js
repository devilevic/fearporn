// src/db.js
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data.sqlite");

// Ensure parent directory exists (works with Render disk mount /var/data)
try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch (e) {
  // If /var/data isn't mounted/writable, fail loudly (you fixed this by re-adding the disk)
  throw e;
}

const db = new Database(DB_PATH);

// Pragmas (safe defaults)
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

// Create the table if it doesn't exist (latest schema we want)
db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    url TEXT UNIQUE,
    source_name TEXT,
    source_domain TEXT,
    category TEXT,
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

// Migrations: add anything code might SELECT/INSERT
ensureColumn("articles", "title", "TEXT");
ensureColumn("articles", "url", "TEXT");
ensureColumn("articles", "source_name", "TEXT");
ensureColumn("articles", "source_domain", "TEXT");
ensureColumn("articles", "category", "TEXT");       // <-- fixes your current error
ensureColumn("articles", "summary", "TEXT");
ensureColumn("articles", "created_at", "TEXT");
ensureColumn("articles", "summarized_at", "TEXT");

module.exports = db;