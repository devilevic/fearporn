const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

let DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data.sqlite");

try {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
} catch (e) {
  // Don't crash the whole service if the disk path isn't writable
  // (Render disk missing/mis-mounted/permissions). Fall back so app stays up.
  const fallback = "/tmp/data.sqlite";
  console.error(`DB dir not writable for ${DB_PATH}. Falling back to ${fallback}`);
  DB_PATH = fallback;
  process.env.DB_PATH = fallback;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
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