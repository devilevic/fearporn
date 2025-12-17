const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || "data.sqlite";
const db = new Database(dbPath);

// 1) Ensure base table exists (new installs)
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
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// 2) Migrate old DBs safely (existing installs)
function hasColumn(table, col) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === col);
}

try {
  if (!hasColumn("articles", "summarized_at")) {
    db.exec(`ALTER TABLE articles ADD COLUMN summarized_at TEXT;`);
  }
  if (!hasColumn("articles", "updated_at")) {
    db.exec(`ALTER TABLE articles ADD COLUMN updated_at TEXT;`);
  }
} catch (e) {
  // If something goes wrong, don’t crash the whole app
  console.error("DB migration error:", e.message);
}

// 3) Create indexes AFTER migration (critical)
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at);`); } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);`); } catch {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_summarized_at ON articles(summarized_at);`); } catch {}

module.exports = db;