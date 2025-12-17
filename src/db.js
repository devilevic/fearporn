const Database = require("better-sqlite3");
const path = require("path");

// const db = new Database(path.join(__dirname, "..", "data.sqlite"));
const dbPath = process.env.DB_PATH || "data.sqlite";
const db = new Database(dbPath);

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

CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles(created_at);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category);
`);

module.exports = db;