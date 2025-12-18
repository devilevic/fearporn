const express = require("express");
const path = require("path");
const { execSync } = require("child_process");

const app = express();

// static files
app.use(express.static("public"));

// database (local sqlite in container)
process.env.DB_PATH = path.join(__dirname, "data.sqlite");

// --- RUN INGEST + SUMMARIZE ON STARTUP ---
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

// run once on boot
runPipeline();

// homepage
const db = require("./src/db");

app.get("/", (req, res) => {
  const rows = db
    .prepare(
      `
      SELECT *
      FROM articles
      WHERE summary IS NOT NULL
      ORDER BY summarized_at DESC
      LIMIT 50
      `
    )
    .all();

  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// port (Render-compatible)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});