// server.js
require("dotenv").config();

const path = require("path");
const express = require("express");
const { spawnSync } = require("child_process");

// IMPORTANT: src/db.js exports the db object directly
const db = require("./src/db");

const app = express();

/* -------------------- Static assets -------------------- */
app.use(express.static(path.join(__dirname, "public")));
app.use("/public", express.static(path.join(__dirname, "public")));

/* -------------------- Health / debug -------------------- */
app.get("/_version", (req, res) => {
  res.type("text").send("VERSION 2025-12-19 server.js");
});

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
      db_path: process.env.DB_PATH || null,
      total,
      summarized,
      unsummarized,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* -------------------- API -------------------- */
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

/* -------------------- Frontend -------------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

/* -------------------- ADMIN: run pipeline -------------------- */
/* TEMPORARY – remove later */
app.get("/admin/run", (req, res) => {
  try {
    const token = req.query.token || req.get("x-admin-token");
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).send("Unauthorized");
    }

    const run = (label, script) => {
      const r = spawnSync(process.execPath, [script], {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      return {
        label,
        status: r.status,
        stdout: (r.stdout || "").slice(-8000),
        stderr: (r.stderr || "").slice(-8000),
      };
    };

    const ingest = run("ingest", "scripts/ingest.js");
    if (ingest.status !== 0) {
      return res.status(500).json({ step: "ingest", ...ingest });
    }

    const summarize = run("summarize", "scripts/summarize_batch.js");
    if (summarize.status !== 0) {
      return res.status(500).json({ step: "summarize", ...summarize });
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(500).send(e.message);
  }
});

/* -------------------- Start server -------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});