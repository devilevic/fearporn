const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 10000;

// --------------------
// Static files
// --------------------
app.use(express.static(path.join(__dirname, "public")));

// --------------------
// Database
// --------------------
const dbPath = process.env.DB_PATH || "/var/data/data.sqlite";
const db = new Database(dbPath);

// --------------------
// Homepage
// --------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// --------------------
// Article permalink page
// --------------------
app.get("/a/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "article.html"));
});

// --------------------
// API: list articles (used by homepage)
// --------------------
app.get("/api/articles", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || "5000", 10), 5000);
  const rows = db
    .prepare(
      `
      SELECT *
      FROM articles
      WHERE summarized_at IS NOT NULL
      ORDER BY published_at DESC
      LIMIT ?
    `
    )
    .all(limit);

  res.json(rows);
});

// --------------------
// API: single article (used by permalink page)
// --------------------
app.get("/api/articles/:id", (req, res) => {
  const row = db
    .prepare(
      `
      SELECT *
      FROM articles
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(req.params.id);

  if (!row) {
    return res.status(404).json({ error: "Article not found" });
  }

  res.json(row);
});

// --------------------
// Start server
// --------------------
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});