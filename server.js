"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");
const db = require("./src/db");

const app = express();

const { execSync } = require("child_process");

// quick sanity check route
app.get("/admin/ping", (req, res) => {
  res.type("text/plain").send("pong");
});

// runs ingest + summarize inside the web service container
app.get("/admin/run", (req, res) => {
  const token = req.query.token;

  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).type("text/plain").send("Unauthorized");
  }

  try {
    const ingestOut = execSync("node scripts/ingest.js", { encoding: "utf8" });
    const sumOut = execSync("node scripts/summarize_batch.js", { encoding: "utf8" });

    res.type("text/plain").send(
      `OK\n\n--- INGEST ---\n${ingestOut}\n\n--- SUMMARIZE ---\n${sumOut}\n`
    );
  } catch (e) {
    res.status(500).type("text/plain").send(String(e?.stack || e));
  }
});



// ---------- Static ----------
app.use("/public", express.static(path.join(__dirname, "public")));

// ---------- Config ----------
const SITE_NAME = process.env.SITE_NAME || "fearporn";
const BASE_URL = process.env.BASE_URL || "";

// ---------- Helpers ----------
function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtDate(sqliteDate) {
  if (!sqliteDate) return "";
  const d = new Date(String(sqliteDate).replace(" ", "T") + "Z");
  if (isNaN(d)) return sqliteDate;

  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const h = String(d.getUTCHours()).padStart(2, "0");
  const m = String(d.getUTCMinutes()).padStart(2, "0");

  return `${month} ${day}, ${h}:${m}`;
}

function domainFromUrl(url) {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function renderSummary(summary, url) {
  if (!summary) return "";

  let text = summary.trim().replace(/^\s+/, "");

  // Remove any Source URL and re-add clean one
  text = text.replace(/Source:\s*https?:\/\/\S+/gi, "").trim();

  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");

  const source = url
    ? `<div class="source">Source: <a href="${escapeHtml(
        url
      )}" target="_blank" rel="noopener">${escapeHtml(
        domainFromUrl(url)
      )}</a></div>`
    : "";

  return paragraphs + source;
}

// ---------- Routes ----------

// Homepage
app.get("/", (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10), 1);
  const limit = 20;
  const offset = (page - 1) * limit;

  const total = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM articles
       WHERE summary IS NOT NULL AND summary != ''`
    )
    .get().c;

  const rows = db
    .prepare(
      `SELECT id, title, url, category, created_at, summary
       FROM articles
       WHERE summary IS NOT NULL AND summary != ''
       ORDER BY datetime(created_at) DESC
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset);

  const cards = rows
    .map((r) => {
      return `
        <article class="card">
          <div class="meta">${escapeHtml(
            (r.category || "world").toLowerCase()
          )} • ${fmtDate(r.created_at)}</div>
          <h2 class="title">${escapeHtml(r.title)}</h2>
          <div class="summary">
            ${renderSummary(r.summary, r.url)}
          </div>
        </article>
      `;
    })
    .join("");

  const pages = Math.ceil(total / limit);
  let pager = "";

  if (pages > 1) {
    pager = `<div class="pager">`;
    for (let p = 1; p <= pages; p++) {
      pager +=
        p === page
          ? `<b>${p}</b>`
          : `<a href="/?page=${p}">${p}</a>`;
    }
    pager += `</div>`;
  }

  res.send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(SITE_NAME)}</title>
  <link rel="stylesheet" href="/public/style.css"/>
  <script src="/public/theme.js" defer></script>
</head>
<body>

<header>
  <div class="header-inner">
    <div class="header-row">
      <div>
        <h1>${escapeHtml(SITE_NAME)}</h1>
        <div class="tagline">bringing the worst humanity has to offer</div>
      </div>
      <button id="themeToggle" class="theme-toggle">
        <span class="theme-icon">◐</span>
        <span class="theme-label">theme</span>
      </button>
    </div>
  </div>
</header>

<main>
  ${cards || `<div class="pending">No summarized articles yet.</div>`}
  ${pager}
</main>

</body>
</html>`);
});

// --- Admin trigger (temporary) ---
app.post("/admin/run", async (req, res) => {
  const token = req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).send("Unauthorized");
  }

  try {
    const { ingestOnce } = require("./scripts/ingest");
    const { summarizeBatchOnce } = require("./scripts/summarize_batch");

    const ing = await ingestOnce();
    const sum = await summarizeBatchOnce();

    res.json({ ok: true, ingested: ing, summarized: sum });
  } catch (e) {
    console.error(e);
    res.status(500).send(String(e?.stack || e));
  }
});



// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});