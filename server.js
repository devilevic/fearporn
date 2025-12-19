// server.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const { db, DB_PATH } = require("./src/db");

const app = express();

// Static assets (so /style.css and /theme.js work)
app.use(express.static(path.join(__dirname, "public")));
app.use("/public", express.static(path.join(__dirname, "public")));

// Version endpoint
app.get("/_version", (req, res) => {
  res.type("text").send(`VERSION 2025-12-19 server.js`);
});

// Debug endpoint (helps stop guessing)
app.get("/_debug", (req, res) => {
  try {
    const total = db.prepare("SELECT COUNT(*) AS c FROM articles").get().c;
    const summarized = db
      .prepare("SELECT COUNT(*) AS c FROM articles WHERE summary IS NOT NULL AND summary != ''")
      .get().c;
    const unsummarized = db
      .prepare("SELECT COUNT(*) AS c FROM articles WHERE summary IS NULL OR summary = ''")
      .get().c;

    res.json({
      ok: true,
      db_path: process.env.DB_PATH || DB_PATH,
      total,
      summarized,
      unsummarized,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// API: only summarized articles
app.get("/api/articles", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
        SELECT
          id,
          category,
          title,
          url,
          source_name,
          source_domain,
          published_at,
          created_at,
          summarized_at,
          summary
        FROM articles
        WHERE summary IS NOT NULL AND summary != ''
        ORDER BY summarized_at DESC
        LIMIT 50
      `
      )
      .all();

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Frontend
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});