const express = require("express");
const path = require("path");
const { execSync } = require("child_process");

const app = express();

/* --------------------------------------------------
   STATIC FILES
   -------------------------------------------------- */

// Serve files from /public as root static assets
// This makes /style.css and /theme.js work
app.use(express.static(path.join(__dirname, "public")));

// Also allow /public/style.css (belt & suspenders)
app.use("/public", express.static(path.join(__dirname, "public")));

/* --------------------------------------------------
   VERSION CHECK (debug helper)
   -------------------------------------------------- */
app.get("/_version", (req, res) => {
  res.type("text/plain").send("VERSION 2025-12-18 FINAL SERVER.JS");
});

/* --------------------------------------------------
   DATABASE
   -------------------------------------------------- */

// IMPORTANT: DB path relative to project root
process.env.DB_PATH = path.join(__dirname, "data.sqlite");

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
    const rows = db.prepare(`
      SELECT
        id,
        title,
        url,
        summary,
        source_domain,
        category,
        summarized_at
      FROM articles
      WHERE summary IS NOT NULL
      ORDER BY summarized_at DESC
      LIMIT 50
    `).all();

    res.json(rows);
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
   START SERVER (Render-compatible)
   -------------------------------------------------- */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});