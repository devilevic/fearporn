const express = require("express");
const path = require("path");
const { execSync } = require("child_process");

const app = express();

/* --------------------------------------------------
   STATIC FILES
   -------------------------------------------------- */

// Serve /public as web root (so /style.css works)
app.use(express.static(path.join(__dirname, "public")));
// Also allow /public/style.css (optional)
app.use("/public", express.static(path.join(__dirname, "public")));

/* --------------------------------------------------
   VERSION CHECK
   -------------------------------------------------- */
app.get("/_version", (req, res) => {
  res.type("text/plain").send("VERSION 2025-12-19 server.js");
});

/* --------------------------------------------------
   DATABASE PATH
   -------------------------------------------------- */
/**
 * IMPORTANT:
 * - On Render, set DB_PATH to your persistent disk path (e.g. /var/data/data.sqlite)
 * - Locally, it falls back to ./data.sqlite
 */
if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(__dirname, "data.sqlite");
}

const db = require("./src/db");

/* --------------------------------------------------
   PIPELINE (INGEST + SUMMARIZE)
   -------------------------------------------------- */

function runPipeline() {
  try {
    console.log("Running ingest...");
    execSync("node scripts/ingest.js", { stdio: "inherit" });

    console.log("Running summarize...");
    execSync("node scripts/summarize_batch.js", { stdio: "inherit" });

    console.log("Pipeline complete.");
  } catch (err) {
    console.error("Pipeline failed:", err.message);
  }
}

// Run once on startup
runPipeline();

/* --------------------------------------------------
   API
   -------------------------------------------------- */

app.get("/api/articles", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
        SELECT
          id,
          title,
          url,
          summary,
          category,
          summarized_at
        FROM articles
        WHERE summary IS NOT NULL
        ORDER BY summarized_at DESC
        LIMIT 50
      `
      )
      .all();

    // Derive source_domain from url (no DB column required)
    const enriched = rows.map((r) => {
      let domain = "";
      try {
        domain = new URL(r.url).hostname.replace(/^www\./, "");
      } catch {}
      return { ...r, source_domain: domain };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* --------------------------------------------------
   FRONTEND
   -------------------------------------------------- */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

/* --------------------------------------------------
   START SERVER (Render compatible)
   -------------------------------------------------- */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});