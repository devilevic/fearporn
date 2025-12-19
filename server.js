// server.js
require("dotenv").config();

const path = require("path");
const express = require("express");
const { spawn } = require("child_process");

const db = require("./src/db");

const app = express();

/* -------------------- Static assets -------------------- */
app.use(express.static(path.join(__dirname, "public")));
app.use("/public", express.static(path.join(__dirname, "public")));

/* -------------------- Helpers: schema-safe selects -------------------- */
let _articlesColsCache = null;

function getArticlesColumns() {
  if (_articlesColsCache) return _articlesColsCache;
  const cols = db
    .prepare("PRAGMA table_info(articles)")
    .all()
    .map((r) => r.name);
  _articlesColsCache = new Set(cols);
  return _articlesColsCache;
}

function hasCol(name) {
  return getArticlesColumns().has(name);
}

function pickCols(preferred) {
  const set = getArticlesColumns();
  return preferred.filter((c) => set.has(c));
}

function bestOrderBy() {
  // Prefer "created_at" (published on fearporn), otherwise feed time, otherwise id
  if (hasCol("created_at")) return "created_at DESC";
  if (hasCol("published_at")) return "published_at DESC";
  return "id DESC";
}

/* -------------------- Pipeline runner (NON-BLOCKING, self-healing lock) -------------------- */
let pipelineRunning = false;
let pipelineChild = null;
let pipelineStartedAt = null;

function runPipelineAsync(label = "manual") {
  if (pipelineRunning) return { ok: false, reason: "pipeline already running" };

  pipelineRunning = true;
  pipelineStartedAt = Date.now();

  pipelineChild = spawn(
    "bash",
    ["-lc", "node scripts/ingest.js && node scripts/summarize_batch.js"],
    { cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] }
  );

  pipelineChild.stdout.on("data", (d) => process.stdout.write(`[pipeline:${label}] ${d}`));
  pipelineChild.stderr.on("data", (d) => process.stderr.write(`[pipeline:${label}] ${d}`));

  pipelineChild.on("close", (code) => {
    pipelineRunning = false;
    pipelineChild = null;
    pipelineStartedAt = null;
    console.log(`[pipeline:${label}] exit code ${code}`);
  });

  // Safety: kill after 30 minutes AND release lock even if "close" never fires.
  setTimeout(() => {
    if (!pipelineRunning) return;
    console.error(`[pipeline:${label}] timeout -> killing child and releasing lock`);

    try {
      if (pipelineChild) pipelineChild.kill("SIGKILL");
    } catch {}

    pipelineRunning = false;
    pipelineChild = null;
    pipelineStartedAt = null;
  }, 30 * 60 * 1000);

  return { ok: true };
}

/* -------------------- Health / debug -------------------- */
app.get("/_version", (req, res) => {
  res.type("text").send("VERSION 2025-12-19 server.js + scheduler + admin");
});

app.get("/_debug", (req, res) => {
  try {
    const cols = Array.from(getArticlesColumns());

    const total = db.prepare("SELECT COUNT(*) AS c FROM articles").get().c;

    // summary column should exist; if not, we degrade gracefully
    let summarized = 0;
    let unsummarized = total;

    if (hasCol("summary")) {
      summarized = db
        .prepare("SELECT COUNT(*) AS c FROM articles WHERE summary IS NOT NULL AND summary != ''")
        .get().c;
      unsummarized = db
        .prepare("SELECT COUNT(*) AS c FROM articles WHERE summary IS NULL OR summary = ''")
        .get().c;
    }

    res.json({
      ok: true,
      db_path: process.env.DB_PATH || null,
      columns: cols,
      total,
      summarized,
      unsummarized,
      pipeline: {
        running: pipelineRunning,
        pid: pipelineChild?.pid || null,
        startedAt: pipelineStartedAt,
      },
      scheduler: {
        enabled: process.env.ENABLE_SCHEDULER === "true",
        interval_ms: Number(process.env.SCHEDULER_INTERVAL_MS || 1800000),
      },
    });
  } catch (e) {
    res.json({ ok: false, error: e?.message || String(e) });
  }
});

/* -------------------- Pages -------------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/article/:id", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "article.html"));
});

/* -------------------- API -------------------- */
app.get("/api/articles", (req, res) => {
  try {
    // Use only columns that actually exist to avoid "no such column" crashes
    const cols = pickCols([
      "id",
      "title",
      "url",
      "category",
      "published_at",
      "created_at",
      "summary",
      "source_domain",
    ]);

    if (!cols.includes("id") || !cols.includes("title")) {
      return res.status(500).json({ error: "articles table missing required columns (id/title)" });
    }

    const whereSummary = hasCol("summary")
      ? "WHERE summary IS NOT NULL AND summary != ''"
      : "";

    const sql = `
      SELECT ${cols.join(", ")}
      FROM articles
      ${whereSummary}
      ORDER BY ${bestOrderBy()}
      LIMIT 100
    `;

    const rows = db.prepare(sql).all();
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get("/api/articles/:id", (req, res) => {
  try {
    const cols = pickCols([
      "id",
      "title",
      "url",
      "category",
      "published_at",
      "created_at",
      "summary",
      "source_domain",
    ]);

    const sql = `
      SELECT ${cols.join(", ")}
      FROM articles
      WHERE id = ?
      LIMIT 1
    `;

    const row = db.prepare(sql).get(req.params.id);
    if (!row) return res.status(404).send("Not found");
    if (hasCol("summary") && (!row.summary || row.summary === "")) return res.status(404).send("Not found");

    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/* -------------------- Admin endpoints (optional) -------------------- */
if (process.env.ENABLE_ADMIN_RUN === "true") {
  const auth = (req, res) => {
    const token = req.query.token || req.get("x-admin-token");
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      res.status(401).send("Unauthorized");
      return false;
    }
    return true;
  };

  app.get("/admin/run", (req, res) => {
    if (!auth(req, res)) return;

    const started = runPipelineAsync("admin");
    if (!started.ok) return res.status(409).json(started);

    // return immediately (non-blocking)
    res.json({ ok: true, started: true });
  });

  app.get("/admin/status", (req, res) => {
    if (!auth(req, res)) return;
    res.json({
      pipelineRunning,
      pid: pipelineChild?.pid || null,
      startedAt: pipelineStartedAt,
    });
  });

  app.get("/admin/reset", (req, res) => {
    if (!auth(req, res)) return;
    pipelineRunning = false;
    pipelineChild = null;
    pipelineStartedAt = null;
    res.json({ ok: true, reset: true });
  });
}

/* -------------------- Scheduler -------------------- */
let schedulerTickRunning = false;

function startScheduler() {
  const enabled = process.env.ENABLE_SCHEDULER === "true";
  if (!enabled) return;

  const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 1800000); // 30 min default
  console.log(`[scheduler] enabled, interval ${intervalMs}ms`);

  const tick = () => {
    if (schedulerTickRunning) {
      console.log("[scheduler] previous tick still active, skipping");
      return;
    }
    schedulerTickRunning = true;

    try {
      console.log("[scheduler] starting pipeline...");
      const started = runPipelineAsync("scheduler");
      if (!started.ok) console.log(`[scheduler] skip: ${started.reason}`);
    } catch (e) {
      console.error("[scheduler] error:", e?.message || e);
    } finally {
      schedulerTickRunning = false;
    }
  };

  setTimeout(tick, 5000);
  setInterval(tick, intervalMs);
}

/* -------------------- Start server -------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startScheduler();
});