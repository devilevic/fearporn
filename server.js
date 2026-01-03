require("dotenv").config();

const express = require("express");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const Database = require("better-sqlite3");

const app = express();

const PORT = process.env.PORT || 10000;
const SITE_NAME = process.env.SITE_NAME || "fearporn.world";

const DB_PATH = process.env.DB_PATH || "/var/data/data.sqlite";
const ENABLE_SCHEDULER = String(process.env.ENABLE_SCHEDULER || "true") === "true";
const SCHEDULER_INTERVAL = Number(process.env.SCHEDULER_INTERVAL || 30 * 60 * 1000);

const ENABLE_ADMIN_RUN = String(process.env.ENABLE_ADMIN_RUN || "true") === "true";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

const BASE_URL = process.env.BASE_URL || "";
const RATE_STATE_PATH = process.env.RATE_STATE_PATH || "/var/data/rate_state.json";

const SUMMARY_DAILY_CAP = Number(process.env.SUMMARY_DAILY_CAP || 120);
const SUMMARY_BATCH_LIMIT = Number(process.env.SUMMARY_BATCH_LIMIT || 10);
const SUMMARY_COOLDOWN_MS = Number(process.env.SUMMARY_COOLDOWN_MS || 0);

const ARTICLES_API_LIMIT = Number(process.env.ARTICLES_API_LIMIT || 1000);

const db = new Database(DB_PATH);

function ensureSchema() {
  // If schema is already correct, these will do nothing.
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      source_name TEXT,
      source_domain TEXT,
      category TEXT,
      published_at TEXT,
      summary TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      summarized_at TEXT,
      source_url TEXT
    );
  `);

  // Add missing columns if older DB exists
  const cols = db.prepare(`PRAGMA table_info(articles)`).all().map((c) => c.name);
  const addCol = (name, type) => {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE articles ADD COLUMN ${name} ${type};`);
    }
  };

  addCol("source_url", "TEXT");
  addCol("published_at", "TEXT");
  addCol("category", "TEXT");
  addCol("source_name", "TEXT");
  addCol("source_domain", "TEXT");
  addCol("summary", "TEXT");
  addCol("summarized_at", "TEXT");
  addCol("created_at", "TEXT");
}

ensureSchema();

app.use(express.json());

// Static assets (expects public/style.css etc)
app.use(express.static(path.join(__dirname, "public")));

// Views (if you use a views folder)
app.get("/", (req, res) => {
  const filePath = path.join(__dirname, "views", "index.html");
  res.sendFile(filePath);
});

app.get("/_version", (req, res) => {
  res.type("text/plain").send("VERSION 2025-12-20 server.js + scheduler + async pipeline");
});

app.get("/_debug", (req, res) => {
  try {
    const cols = db.prepare(`PRAGMA table_info(articles)`).all().map((c) => c.name);

    const total = db.prepare(`SELECT COUNT(*) AS c FROM articles`).get().c;
    const summarized = db
      .prepare(`SELECT COUNT(*) AS c FROM articles WHERE summary IS NOT NULL AND summary != ''`)
      .get().c;
    const unsummarized = total - summarized;

    const debug = {
      ok: true,
      db_path: DB_PATH,
      columns: cols,
      total,
      summarized,
      unsummarized,
      pipeline: {
        running: pipelineState.running,
        startedAt: pipelineState.startedAt,
        lastRunAt: pipelineState.lastRunAt,
        lastResultOk: pipelineState.lastResultOk,
      },
      scheduler: {
        enabled: ENABLE_SCHEDULER,
        interval_ms: SCHEDULER_INTERVAL,
      },
    };

    res.json(debug);
  } catch (e) {
    res.json({ ok: false, error: String(e && e.message ? e.message : e) });
  }
});

// API: return newest summarized articles
app.get("/api/articles", (req, res) => {
  const limit = Math.min(Number(req.query.limit || ARTICLES_API_LIMIT), ARTICLES_API_LIMIT);

  const rows = db
    .prepare(
      `
      SELECT id, title, url, source_name, source_domain, summary, created_at, summarized_at, category, source_url, published_at
      FROM articles
      WHERE summary IS NOT NULL AND summary != ''
      ORDER BY datetime(COALESCE(summarized_at, created_at)) DESC
      LIMIT ?
    `
    )
    .all(limit);

  res.json(rows);
});

// API: get single article by id
app.get("/api/article/:id", (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare(
      `
      SELECT id, title, url, source_name, source_domain, summary, created_at, summarized_at, category, source_url, published_at
      FROM articles
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(id);

  if (!row) return res.status(404).json({ ok: false, error: "Not found" });
  res.json({ ok: true, article: row });
});

// ✅ Permalink page: /a/:id
app.get("/a/:id", (req, res) => {
  const id = Number(req.params.id);
  const a = db
    .prepare(
      `
      SELECT id, title, url, source_name, source_domain, summary, created_at, summarized_at, category, source_url, published_at
      FROM articles
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(id);

  if (!a) {
    return res.status(404).type("html").send(`
      <!doctype html>
      <html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${SITE_NAME}</title>
      <link rel="stylesheet" href="/style.css" />
      </head>
      <body class="theme-dark">
        <main class="wrap">
          <div class="card">
            <div class="title">Not found</div>
            <div class="meta">This article does not exist.</div>
            <div style="margin-top:14px"><a href="/" style="color:#cc4f00">← Back</a></div>
          </div>
        </main>
        <script src="/theme.js"></script>
      </body></html>
    `);
  }

  const safe = (s) =>
    String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const domain = a.source_domain || (() => {
    try {
      return new URL(a.url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();

  const summary = safe(a.summary || "");
  const title = safe(a.title || "");

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title} — ${SITE_NAME}</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body class="theme-dark">
  <header>
    <div class="header-inner">
      <div class="header-row">

        <div class="brand-block">
          <a href="/" aria-label="Home" style="text-decoration:none;color:inherit;">
          <div class="brand">
            fearporn<span class="brand-dot">.world</span>
          </div>
          </a>
          <div class="tagline">
            bringing out the worst humanity has to offer
          </div>
        </div>

        <button id="themeToggle" class="theme-toggle" type="button">
          <span class="theme-icon">🌙</span>
          <span class="theme-label">Dark</span>
        </button>

      </div>
    </div>
  </header>

  <main class="wrap">
    <article class="card">
      <div class="title">${title}</div>
      <p class="summary">${summary}</p>
      <div class="source">
        Source:
        <a href="${safe(a.url)}" target="_blank" rel="noopener noreferrer">${safe(domain)}</a>
      </div>
      <div style="margin-top:18px">
        <a href="/" style="color:#cc4f00; text-decoration:none;">← Back to homepage</a>
      </div>
    </article>
  </main>

  <script src="/theme.js"></script>
</body>
</html>`);
});

// ---------------- Pipeline control (admin + scheduler) ----------------

const pipelineState = {
  running: false,
  startedAt: null,
  lastRunAt: null,
  lastResultOk: null,
};

let pipelineChild = null;

function isAuthorized(req) {
  if (!ENABLE_ADMIN_RUN) return false;
  const token = String(req.query.token || "");
  return token && ADMIN_TOKEN && token === ADMIN_TOKEN;
}

function runScript(label, command, args, timeoutMs) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            stderr += `\n[pipeline:${label}] timeout after ${timeoutMs}ms -> killing child\n`;
            try {
              child.kill("SIGKILL");
            } catch {}
          }, timeoutMs)
        : null;

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        label,
        code,
        ms: Date.now() - start,
        stdout,
        stderr,
      });
    });
  });
}

async function runPipeline(trigger = "manual") {
  if (pipelineState.running) {
    return { ok: false, reason: "pipeline already running" };
  }

  pipelineState.running = true;
  pipelineState.startedAt = Date.now();
  pipelineState.lastResultOk = null;

  try {
    const ingest = await runScript(
      `${trigger}:ingest`,
      "node",
      ["scripts/ingest.js"],
      6 * 60 * 1000
    );

    if (ingest.code !== 0) {
      pipelineState.lastRunAt = Date.now();
      pipelineState.lastResultOk = false;
      pipelineState.running = false;
      return { ok: false, step: "ingest", ingest };
    }

    if (SUMMARY_COOLDOWN_MS > 0) {
      await new Promise((r) => setTimeout(r, SUMMARY_COOLDOWN_MS));
    }

    const summarize = await runScript(
      `${trigger}:summarize`,
      "node",
      ["scripts/summarize_batch.js"],
      6 * 60 * 1000
    );

    const ok = summarize.code === 0;

    pipelineState.lastRunAt = Date.now();
    pipelineState.lastResultOk = ok;
    pipelineState.running = false;

    return { ok, ingest, summarize, at: new Date().toISOString() };
  } catch (e) {
    pipelineState.lastRunAt = Date.now();
    pipelineState.lastResultOk = false;
    pipelineState.running = false;
    return { ok: false, error: String(e) };
  }
}

app.get("/admin/run", async (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const result = await runPipeline("admin");
  if (result && result.reason === "pipeline already running") {
    return res.status(409).json({ ok: false, reason: "pipeline already running" });
  }

  if (result.ok) return res.json({ ok: true, started: true });

  // If failed immediately, return details
  return res.status(500).json(result);
});

app.get("/admin/status", (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

  res.json({
    pipelineRunning: pipelineState.running,
    startedAt: pipelineState.startedAt,
    lastRunAt: pipelineState.lastRunAt,
    lastResult: pipelineState.lastResult,
  });
});

app.get("/admin/reset", (req, res) => {
  if (!isAuthorized(req)) return res.status(401).json({ ok: false, error: "Unauthorized" });

  pipelineState.running = false;
  pipelineState.startedAt = null;
  pipelineState.lastResultOk = null;

  try {
    if (pipelineChild) {
      pipelineChild.kill("SIGKILL");
      pipelineChild = null;
    }
  } catch {}

  res.json({ ok: true, reset: true });
});

// Scheduler loop
if (ENABLE_SCHEDULER) {
  console.log(`[scheduler] enabled, interval ${SCHEDULER_INTERVAL}ms`);

  setInterval(async () => {
    try {
      if (pipelineState.running) {
        console.log("[scheduler] skip: pipeline already running");
        return;
      }
      console.log("[scheduler] starting pipeline...");
      const r = await runPipeline("scheduler");
      if (r && r.ok) console.log("[scheduler] pipeline OK");
      else console.log("[scheduler] pipeline failed", r && r.reason ? r.reason : "");
    } catch (e) {
      console.log("[scheduler] error", e);
    }
  }, SCHEDULER_INTERVAL);
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});