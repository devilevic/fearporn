"use strict";

require("dotenv").config();

const express = require("express");
const path = require("path");

const db = require("./src/db");

const app = express();

// ----- Static assets -----
app.use("/public", express.static(path.join(__dirname, "public")));

// ----- Config -----
const SITE_NAME = process.env.SITE_NAME || "fearporn";
const BASE_URL = process.env.BASE_URL || "";

// ----- Helpers -----
function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function fmtDate(isoLike) {
  if (!isoLike) return "";
  // Handles "YYYY-MM-DD HH:MM:SS" from sqlite or ISO strings
  const d = new Date(String(isoLike).replace(" ", "T") + (String(isoLike).includes("Z") ? "" : "Z"));
  if (Number.isNaN(d.getTime())) return String(isoLike);

  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${mm} ${dd}, ${hh}:${mi}`;
}

function domainFromUrl(url) {
  try {
    const u = new URL(url);
    return u.host; // includes www if present
  } catch {
    // fallback: try to strip scheme
    return String(url).replace(/^https?:\/\//, "").split("/")[0] || String(url);
  }
}

function summaryToHtml(rawSummary, originalUrl) {
  if (!rawSummary) return "";

  // Remove any leading indentation / whitespace issues
  let s = String(rawSummary).replace(/^\s+/, "").trim();

  // If model included a "Source:" line with a URL, replace it with "Source: domain" link
  // Works whether it's on its own line or inline.
  const url = originalUrl || "";
  const host = url ? domainFromUrl(url) : "";

  // Replace any "Source: <url>" occurrences
  s = s.replace(/Source:\s*(https?:\/\/\S+)/gi, () => {
    if (!url) return "Source:";
    return `Source: ${host}`;
  });

  // Ensure we have a Source line (linked) at end if we have url
  if (url) {
    const hasSource = /(^|\n)Source:\s*/i.test(s);
    if (!hasSource) {
      s += `\n\nSource: ${host}`;
    }
  }

  // Turn into HTML paragraphs
  const parts = s.split(/\n{2,}/g).map((p) => p.trim()).filter(Boolean);

  // Convert the "Source: host" into a clickable link (same line)
  const htmlParts = parts.map((p) => {
    if (/^Source:\s*/i.test(p) && url) {
      const label = p.replace(/^Source:\s*/i, "").trim() || host;
      return `<p class="source-line">Source: <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></p>`;
    }
    // regular paragraph, preserve single newlines
    const safe = escapeHtml(p).replace(/\n/g, "<br/>");
    return `<p>${safe}</p>`;
  });

  return htmlParts.join("\n");
}

function hasColumn(table, col) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some((c) => c.name === col);
  } catch {
    return false;
  }
}

const HAS_SUMMARIZED_AT = hasColumn("articles", "summarized_at");

// ----- Routes -----

// Homepage: only summarized articles
app.get("/", (req, res) => {
  const page = Math.max(parseInt(req.query.page || "1", 10) || 1, 1);
  const limit = 20;
  const offset = (page - 1) * limit;

  const total = db.prepare(`
    SELECT COUNT(*) AS c
    FROM articles
    WHERE summary IS NOT NULL AND summary != ''
  `).get().c;

  const totalPages = Math.max(Math.ceil(total / limit), 1);

  // Sort: prefer summarized_at if it exists, otherwise created_at
  const orderExpr = HAS_SUMMARIZED_AT
    ? "datetime(COALESCE(summarized_at, created_at))"
    : "datetime(created_at)";

  const rows = db.prepare(`
    SELECT id, title, url, category, created_at, summary, source
    ${HAS_SUMMARIZED_AT ? ", summarized_at" : ""}
    FROM articles
    WHERE summary IS NOT NULL AND summary != ''
    ORDER BY ${orderExpr} DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const cards = rows.map((r) => {
    const when = fmtDate((HAS_SUMMARIZED_AT ? r.summarized_at : null) || r.created_at);
    const cat = r.category ? String(r.category) : "world";
    const summaryHtml = summaryToHtml(r.summary, r.url);

    return `
      <article class="card">
        <div class="meta">${escapeHtml(cat)} • ${escapeHtml(when)}</div>
        <h2 class="title">${escapeHtml(r.title)}</h2>
        <div class="summary">${summaryHtml}</div>
      </article>
    `;
  }).join("\n");

  const pagination = (() => {
    if (totalPages <= 1) return "";
    const mk = (p) => `/` + (p === 1 ? "" : `?page=${p}`);
    const links = [];
    for (let p = 1; p <= totalPages; p++) {
      links.push(
        `<a class="page-link ${p === page ? "active" : ""}" href="${mk(p)}">${p}</a>`
      );
    }
    return `<nav class="pagination">${links.join("\n")}</nav>`;
  })();

  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(SITE_NAME)}</title>
  <link rel="stylesheet" href="/public/style.css"/>
  <script src="/public/theme.js" defer></script>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <div class="brand">${escapeHtml(SITE_NAME)}</div>
      <button id="themeToggle" class="theme-toggle" type="button" aria-label="Toggle dark/light">
        ◐
      </button>
    </div>
  </header>

  <main class="wrap">
    ${cards || `<div class="empty">No summarized articles yet.</div>`}
    ${pagination}
  </main>

  <footer class="footer">
    <div class="footer-inner">
      ${BASE_URL ? `<a href="${escapeHtml(BASE_URL)}">${escapeHtml(BASE_URL)}</a>` : ""}
    </div>
  </footer>
</body>
</html>`);
});

// Article page (optional; not used if you removed accordion)
// Still defensive: only uses summarized_at if it exists
app.get("/a/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(404).send("Not found");

  const row = db.prepare(`
    SELECT id, title, url, category, created_at, summary, source
    ${HAS_SUMMARIZED_AT ? ", summarized_at" : ""}
    FROM articles
    WHERE id = ?
  `).get(id);

  if (!row || !row.summary) return res.status(404).send("Not found");

  const when = fmtDate((HAS_SUMMARIZED_AT ? row.summarized_at : null) || row.created_at);
  const cat = row.category ? String(row.category) : "world";
  const summaryHtml = summaryToHtml(row.summary, row.url);

  res.status(200).send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(row.title)} • ${escapeHtml(SITE_NAME)}</title>
  <link rel="stylesheet" href="/public/style.css"/>
  <script src="/public/theme.js" defer></script>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="/">${escapeHtml(SITE_NAME)}</a>
      <button id="themeToggle" class="theme-toggle" type="button" aria-label="Toggle dark/light">
        ◐
      </button>
    </div>
  </header>

  <main class="wrap">
    <article class="card">
      <div class="meta">${escapeHtml(cat)} • ${escapeHtml(when)}</div>
      <h1 class="title">${escapeHtml(row.title)}</h1>
      <div class="summary">${summaryHtml}</div>
    </article>
  </main>
</body>
</html>`);
});

// ----- Start -----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});