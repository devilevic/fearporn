const express = require("express");
const path = require("path");
const { execSync } = require("child_process");

// Force local SQLite DB (container-local, MVP mode)
process.env.DB_PATH = path.join(__dirname, "data.sqlite");

const app = express();

// --- RUN INGEST + SUMMARIZE ON STARTUP ---
try {
  console.log("Running ingest...");
  execSync("node scripts/ingest.js", { stdio: "inherit" });

  console.log("Running summarize...");
  execSync("node scripts/summarize_batch.js", { stdio: "inherit" });

  console.log("Pipeline complete.");
} catch (e) {
  console.error("Pipeline failed:", e.message);
}

// --- DATABASE ---
const db = require("./src/db");

// --- HOME PAGE: PLAIN HTML RENDER ---
app.get("/", (req, res) => {
  let rows;
  try {
    rows = db
      .prepare(`
        SELECT title, summary
        FROM articles
        WHERE summary IS NOT NULL
        ORDER BY summarized_at DESC
        LIMIT 10
      `)
      .all();
  } catch (e) {
    return res
      .status(500)
      .send("DB error:<br><pre>" + e.message + "</pre>");
  }

  if (!rows || rows.length === 0) {
    return res.send("No summarized articles found.");
  }

  let html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Fearporn MVP</title>
      </head>
      <body style="font-family: sans-serif; padding: 40px;">
        <h1>Fearporn MVP</h1>
  `;

  for (const r of rows) {
    html += `
      <h3>${r.title}</h3>
      <p>${r.summary}</p>
      <hr/>
    `;
  }

  html += `
      </body>
    </html>
  `;

  res.send(html);
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});