require("dotenv").config();
const express = require("express");
const db = require("./src/db");

const app = express();
app.use(express.static("public"));

app.get("/", (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = 20;
  const offset = (page - 1) * limit;

  const rows = db.prepare(`
  SELECT id, title, url, category, created_at, summary, source
  FROM articles
  WHERE summary IS NOT NULL AND summary != ''
  ORDER BY datetime(created_at) DESC
  LIMIT 50
`).all();

  const total = db.prepare(`SELECT COUNT(*) AS c FROM articles WHERE summary IS NOT NULL`).get().c;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  // simple HTML without templating yet
  const itemsHtml = rows.map(r => `
    <div class="card">
      <div class="meta">${r.category || "misc"} • ${fmtDate(r.created_at)}</div>
      <div class="title">${escapeHtml(r.title)}</div>
      ${r.summary ? `<div class="summary">${renderSummary(r.summary)}</div>` : `<div class="pending">No summary yet.</div>`}
    </div>
  `).join("");

  const pager = Array.from({ length: totalPages }, (_, i) => i + 1)
    .slice(Math.max(0, page - 4), Math.min(totalPages, page + 3))
    .map(p => p === page ? `<b>${p}</b>` : `<a href="/?page=${p}">${p}</a>`)
    .join(" ");

  res.send(`
  <html>
    <head>
      <meta charset="utf-8"/>
      <title>${process.env.SITE_NAME || "fearporn.local"}</title>
      <link rel="stylesheet" href="/style.css"/>
      <script src="/theme.js" defer></script>
    </head>
    <body>
      <header>
        <div class="header-inner">
          <div class="header-row">
            <div>
              <h1>fearporn.world</h1>
              <p class="tagline">bringing the worst humanity has to offer</p>
            </div>

            <button id="themeToggle" class="theme-toggle" type="button" aria-label="Toggle theme">
              <span class="theme-icon" aria-hidden="true">🌙</span>
              <span class="theme-label">Dark</span>
            </button>
          </div>
        </div>
      </header>
      <main>
        ${itemsHtml || "<p>No articles yet. Run ingest.</p>"}
        <div class="pager">${pager}</div>
      </main>
    </body>
  </html>
  `);
});

app.get("/a/:id", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const r = db.prepare(`
    SELECT id, title, url, category, created_at, summarized_at, summary, source
    FROM articles WHERE id = ?
  `).get(id);

  if (!r) return res.status(404).send("Not found");

  if (!r.summary) return res.status(404).send("Not found");

  res.send(`
  <html>
    <head>
      <meta charset="utf-8"/>
      <title>${escapeHtml(r.title)}</title>
      <link rel="stylesheet" href="/style.css"/>
    </head>
    <body>
      <header>
        <a href="/">← back</a>
      </header>
      <main>
        <h2>${escapeHtml(r.title)}</h2>
        <div class="meta">
          ${escapeHtml(r.category || "misc")} • ${fmtDate(r.summarized_at || r.created_at)} • ${escapeHtml(r.source || "")}
        </div>
        ${r.summary ? `<div class="summary">${renderSummary(r.summary)}</div>` : "<p>No summary yet.</p>"}
        
      </main>
    </body>
  </html>
  `);
});

function fmtDate(value) {
  if (!value) return "";

  // Normalize SQLite + RSS dates
  const d = new Date(
    value.includes("T")
      ? value
      : value.replace(" ", "T") + "Z"
  );

  if (isNaN(d.getTime())) return "";

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const day = String(d.getDate()).padStart(2, "0");
  const month = months[d.getMonth()];
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  return `${month} ${day}, ${hours}:${minutes}`;
}

function sourceLink(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderSummary(summary) {
  if (!summary) return "";

  // Look for "Source: <url>"
  const match = summary.match(/Source:\s*(https?:\/\/\S+)/i);

  if (!match) {
    return escapeHtml(summary);
  }

  const url = match[1];
  const domain = sourceLink(url);

  // Remove the Source line from the text
const cleaned = summary
  .replace(match[0], "")        // remove Source: <url>
  .replace(/\r\n/g, "\n")       // normalize Windows line endings
  .replace(/^\s+/, "")          // remove leading whitespace/newlines
  .replace(/\s+$/, "");         // remove trailing whitespace

return (
  escapeHtml(cleaned) +
  `<div class="source">
    Source: <a href="${url}" target="_blank" rel="noopener noreferrer">${domain}</a>
  </div>`
);
}


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});