require("dotenv").config();

const express = require("express");
const path = require("path");
const { spawn } = require("child_process");

// IMPORTANT: your src/db.js exports the db object directly (module.exports = db)
const db = require("./src/db");

// For debugging only (src/db.js uses process.env.DB_PATH or ./data.sqlite)
const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data.sqlite");

const app = express();

/* -------------------- Static assets -------------------- */
app.use(express.static(path.join(__dirname, "public")));

/* -------------------- Helpers -------------------- */
function nowIso() {
  return new Date().toISOString();
}

function requireAdmin(req, res) {
  const token = req.query.token || req.get("x-admin-token");
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

function runScript(scriptPath, label, timeoutMs = 8 * 60 * 1000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const startedAt = Date.now();

    const killTimer = setTimeout(() => {
      stderr += `\n[pipeline:${label}] timeout after ${timeoutMs}ms -> killing child\n`;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      clearTimeout(killTimer);
      resolve({
        label,
        code,
        ms: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
  });
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatStamp(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Similar vibe to your UI: "Dec 28, 16:22"
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/* -------------------- Feed shaping ("soft diversity") -------------------- */
// We do NOT cap tabloids. Instead we lightly shape the returned list so the homepage
// doesn't get stuck on the exact same domain/story in consecutive cards.
//
// Strategy:
// - Keep recency bias (we always pick from the front of the queue)
// - Avoid back-to-back same domain when possible
// - Avoid showing near-duplicate headlines repeatedly in a short window

function normalizeTitleKey(title) {
  const t = String(title || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const stop = new Set([
    "a","an","and","are","as","at","be","but","by","for","from","has","have","in","into","is","it","its",
    "of","on","or","s","that","the","this","to","vs","was","were","with","after","before","over","under",
    "about","against","amid","says","say","new","breaking",
  ]);

  const words = t
    .split(" ")
    .filter((w) => w.length > 2 && !stop.has(w))
    .slice(0, 10);

  return words.join(" ");
}

function shapeFeed(rows, opts = {}) {
  const scanLimit = Math.max(50, Math.min(500, opts.scanLimit || 180));
  const recentWindow = Math.max(10, Math.min(120, opts.recentWindow || 40));

  const queue = rows.slice();
  const out = [];
  let lastDomain = "";
  const recentKeys = [];
  const recentKeySet = new Set();

  function remember(key) {
    if (!key) return;
    recentKeys.push(key);
    recentKeySet.add(key);
    while (recentKeys.length > recentWindow) {
      const old = recentKeys.shift();
      if (!recentKeys.includes(old)) recentKeySet.delete(old);
    }
  }

  while (queue.length) {
    let pickIdx = -1;

    // 1) Prefer: domain != last AND titleKey not in recent window
    for (let i = 0; i < Math.min(scanLimit, queue.length); i++) {
      const r = queue[i];
      const dom = (r.source_domain || "").toLowerCase();
      const key = normalizeTitleKey(r.title);
      if (dom && dom === lastDomain) continue;
      if (key && recentKeySet.has(key)) continue;
      pickIdx = i;
      break;
    }

    // 2) Fallback: domain != last
    if (pickIdx === -1) {
      for (let i = 0; i < Math.min(scanLimit, queue.length); i++) {
        const r = queue[i];
        const dom = (r.source_domain || "").toLowerCase();
        if (dom && dom === lastDomain) continue;
        pickIdx = i;
        break;
      }
    }

    // 3) Final fallback: take the most recent remaining item
    if (pickIdx === -1) pickIdx = 0;

    const [picked] = queue.splice(pickIdx, 1);
    out.push(picked);

    const dom = (picked.source_domain || "").toLowerCase();
    if (dom) lastDomain = dom;
    remember(normalizeTitleKey(picked.title));
  }

  return out;
}

/* -------------------- Pipeline state / lock -------------------- */
const pipeline = {
  running: false,
  startedAt: null,
  lastRunAt: null,
  lastResult: null,
};

async function runPipeline(reason = "manual") {
  if (pipeline.running) {
    return { ok: false, reason: "pipeline already running" };
  }

  pipeline.running = true;
  pipeline.startedAt = Date.now();

  try {
    const ingest = await runScript("scripts/ingest.js", `${reason}:ingest`, 6 * 60 * 1000);
    if (ingest.code !== 0) {
      pipeline.lastResult = { ok: false, step: "ingest", ingest, at: nowIso() };
      return pipeline.lastResult;
    }

    const summarize = await runScript(
      "scripts/summarize_batch.js",
      `${reason}:summarize`,
      10 * 60 * 1000
    );
    if (summarize.code !== 0) {
      pipeline.lastResult = { ok: false, step: "summarize", summarize, at: nowIso() };
      return pipeline.lastResult;
    }

    pipeline.lastResult = { ok: true, at: nowIso(), ingest, summarize };
    return pipeline.lastResult;
  } finally {
    pipeline.running = false;
    pipeline.lastRunAt = Date.now();
  }
}

/* -------------------- Pages -------------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

/**
 * Permalink page
 * Example: /a/400
 */
app.get("/a/:id", (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).type("text").send("Invalid article id");
    }

    const row = db
      .prepare(
        `
        SELECT id, title, url, category, published_at, created_at, summary, source_domain, source_name
        FROM articles
        WHERE id = ?
        LIMIT 1
      `
      )
      .get(id);

    if (!row) {
      return res.status(404).type("text").send("Article not found");
    }

    const stamp = formatStamp(row.published_at || row.created_at);
    const cat = row.category ? escapeHtml(row.category) : "";
    const title = escapeHtml(row.title);
    const summary = escapeHtml(row.summary || "");
    const source = escapeHtml(row.source_domain || row.source_name || "");
    const sourceUrl = row.url || "";

    const pageTitle = row.title ? `${row.title} — fearporn.world` : "fearporn.world";

    // Uses your existing CSS + theme.js
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(pageTitle)}</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body class="theme-dark">
  <header>
    <div class="header-inner">
      <div class="header-row">
        <div class="brand-block">
          <div class="brand">
            fearporn<span class="brand-dot">.world</span>
          </div>
          <div class="tagline">bringing out the worst humanity has to offer</div>
        </div>

        <button id="themeToggle" class="theme-toggle" type="button">
          <span class="theme-icon">🌙</span>
          <span class="theme-label">Dark</span>
        </button>
      </div>
    </div>
  </header>

  <main class="wrap">
    <div class="article-card">
      <div class="meta">${cat}${cat && stamp ? " • " : ""}${stamp}</div>
      <div class="title">${title}</div>

      ${summary ? `<div class="summary">${summary}</div>` : ""}

      <div class="source">
        Source:
        <a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${source || "link"}</a>
      </div>
    </div>

    <div class="pagination">
      <a href="/" class="page-link">&larr; Back</a>
    </div>
  </main>

  <script src="/theme.js"></script>
</body>
</html>`;

    res.type("html").send(html);
  } catch (e) {
    res.status(500).type("text").send(e.message);
  }
});

/* -------------------- API -------------------- */
app.get("/api/articles", (req, res) => {
  try {
    // Only show summarized articles
    const rows = db
      .prepare(
        `
        SELECT id, title, url, category, published_at, created_at, summarized_at, summary, source_domain, source_name
        FROM articles
        WHERE summary IS NOT NULL AND summary != ''
        ORDER BY datetime(created_at) DESC
        LIMIT 5000
      `
      )
      .all();

    // Soft diversity shaping (no caps): interleave domains + reduce near-duplicate headlines.
    const shaped = shapeFeed(rows);
    res.json(shaped);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* -------------------- Health / debug -------------------- */
app.get("/_version", (req, res) => {
  res.type("text").send("VERSION 2025-12-20 server.js + scheduler + async pipeline");
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

    const cols = db.prepare("PRAGMA table_info(articles)").all().map((r) => r.name);

    res.json({
      ok: true,
      db_path: DB_PATH,
      columns: cols,
      total,
      summarized,
      unsummarized,
      pipeline: {
        running: pipeline.running,
        startedAt: pipeline.startedAt,
        lastRunAt: pipeline.lastRunAt,
        lastResultOk: pipeline.lastResult?.ok ?? null,
      },
      scheduler: {
        enabled: (process.env.SCHEDULER_ENABLED || "true") === "true",
        interval_ms: parseInt(process.env.SCHEDULER_INTERVAL_MS || "1800000", 10),
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* -------------------- Admin -------------------- */
app.get("/admin/run", async (req, res) => {
  if (!requireAdmin(req, res)) return;

  if (pipeline.running) {
    return res.status(409).json({ ok: false, reason: "pipeline already running" });
  }

  runPipeline("admin").catch(() => {});
  res.json({ ok: true, started: true });
});

app.get("/admin/status", (req, res) => {
  if (!requireAdmin(req, res)) return;

  res.json({
    pipelineRunning: pipeline.running,
    startedAt: pipeline.startedAt,
    lastRunAt: pipeline.lastRunAt,
    lastResult: pipeline.lastResult,
  });
});

// Domain distribution (quick sanity tool)
// Examples:
//   /admin/sources?token=...               -> all time
//   /admin/sources?token=...&days=7        -> last 7 days
//   /admin/sources?token=...&days=2&limit=20
app.get("/admin/sources", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const days = req.query.days ? Number(req.query.days) : null;
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  const summarizedOnly = (req.query.summarized_only || "true") !== "false";

  try {
    let where = "1=1";
    const params = {};

    if (summarizedOnly) {
      where += " AND summary IS NOT NULL AND summary != ''";
    }

    if (days && Number.isFinite(days) && days > 0) {
      // Use created_at for consistency with feed ordering.
      where += " AND datetime(created_at) >= datetime('now', @since)";
      params.since = `-${Math.floor(days)} days`;
    }

    const rows = db
      .prepare(
        `
        SELECT COALESCE(NULLIF(source_domain, ''), COALESCE(NULLIF(source_name, ''), '(unknown)')) AS domain,
               COUNT(*) AS count
        FROM articles
        WHERE ${where}
        GROUP BY domain
        ORDER BY count DESC
        LIMIT @limit
      `
      )
      .all({ ...params, limit: Number.isFinite(limit) ? limit : 50 });

    const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM articles WHERE ${where}`).get(params);
    const total = totalRow?.c || 0;

    const out = rows.map((r) => ({
      domain: r.domain,
      count: r.count,
      pct: total ? Math.round((r.count / total) * 1000) / 10 : 0,
    }));

    res.json({ ok: true, days: days || null, summarizedOnly, total, top: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/admin/reset", (req, res) => {
  if (!requireAdmin(req, res)) return;

  pipeline.running = false;
  pipeline.startedAt = null;

  res.json({ ok: true, reset: true });
});

/* -------------------- Scheduler -------------------- */
const schedulerEnabled = (process.env.SCHEDULER_ENABLED || "true") === "true";
const schedulerIntervalMs = parseInt(process.env.SCHEDULER_INTERVAL_MS || "1800000", 10);

if (schedulerEnabled) {
  console.log(`[scheduler] enabled, interval ${schedulerIntervalMs}ms`);
  setInterval(() => {
    if (pipeline.running) return;
    runPipeline("scheduler").catch(() => {});
  }, schedulerIntervalMs);
}

/* -------------------- Start server -------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});