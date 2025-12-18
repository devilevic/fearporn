const express = require("express");
const path = require("path");
const { execSync } = require("child_process");

// MVP mode: local sqlite in the Render container
process.env.DB_PATH = path.join(__dirname, "data.sqlite");

const app = express();

app.use(express.static(path.join(__dirname, "public")));

// Serve your original design assets
app.use("/public", express.static(path.join(__dirname, "public")));

// Run ingest + summarize on startup (keep this because it WORKS)
function runPipeline() {
  try {
    console.log("Running ingest...");
    execSync("node scripts/ingest.js", { stdio: "inherit" });

    console.log("Running summarize...");
    execSync("node scripts/summarize_batch.js", { stdio: "inherit" });

    console.log("Pipeline complete.");
  } catch (e) {
    console.error("Pipeline failed:", e.message);
  }
}
runPipeline();

// DB
const db = require("./src/db");

// API: front-end will call this to render articles
app.get("/api/articles", (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT id, title, url, summary, source_domain, category, summarized_at
      FROM articles
      WHERE summary IS NOT NULL
      ORDER BY summarized_at DESC
      LIMIT 50
      `
    )
    .all();

  res.json(rows);
});

// Serve your original HTML design
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// Render-compatible port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));