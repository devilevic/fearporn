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

/* -------------------- Health / debug -------------------- */
app.get("/_version", (req, res) => {
  res.type("text").send("VERSION 2025-12-19 server.js + scheduler");
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

    res.json({
      ok: true,
      db_path: process.env.DB_PATH || null,
      total,
      summarized,
      unsummarized,
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
    // NOTE: This assumes your current schema supports these fields.
    // If you changed schema recently, keep this query in sync with src/db.js
    const rows = db
      .prepare(
        `
        SELECT
          id, title, url, category,
          published_at, created_at,
          summary, source_domain
        FROM articles
        WHERE summary IS NOT NULL AND summary != ''
        ORDER BY COALESCE(created_at, published_at) DESC
        LIMIT 100
      `
      )
      .all();

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

app.get("/api/articles/:id", (req, res) => {
  try {
    const row = db
      .prepare(
        `
        SELECT
          id, title, url, category,
          published_at, created_at,
          summary, source_domain
        FROM articles
        WHERE id = ?
        `
      )
      .get(req.params.id);

    if (!row) return res.status(404).send("Not found");
    if (!row.summary) return res.status(404).send("Not found"); // only serve summarized
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

/* -------------------- Optional admin trigger -------------------- */
if (process.env.ENABLE_ADMIN_RUN === "true") {
  app.get("/admin/run", (req, res) => {
    try {
      const token = req.query.token || req.get("x-admin-token");
      if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        return res.status(401).send("Unauthorized");
      }

      // non-blocking: return immediately
      const started = runPipelineAsync("admin");
      if (!started.ok) return res.status(409).json(started);

      res.json({ ok: true, started: true });
    } catch (e) {
      res.status(500).send(e?.message || String(e));
    }
  });
}

/* -------------------- Pipeline runner (NON-BLOCKING) -------------------- */
let pipelineRunning = false;

function runPipelineAsync(label = "manual") {
  if (pipelineRunning) return { ok: false, reason: "pipeline already running" };
  pipelineRunning = true;

  const child = spawn(
    "bash",
    ["-lc", "node scripts/ingest.js && node scripts/summarize_batch.js"],
    { cwd: __dirname, stdio: ["ignore", "pipe", "pipe"] }
  );

  child.stdout.on("data", (d) => process.stdout.write(`[pipeline:${label}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[pipeline:${label}] ${d}`));

  child.on("close", (code) => {
    pipelineRunning = false;
    console.log(`[pipeline:${label}] exit code ${code}`);
  });

  // Safety: kill after 30 minutes (prevents “hang forever” situations)
  setTimeout(() => {
    if (!pipelineRunning) return;
    try {
      child.kill("SIGKILL");
    } catch {}
  }, 30 * 60 * 1000);

  return { ok: true };
}

/* -------------------- Scheduler -------------------- */
let schedulerRunning = false;

function startScheduler() {
  const enabled = process.env.ENABLE_SCHEDULER === "true";
  if (!enabled) return;

  const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS || 1800000); // default 30m
  console.log(`[scheduler] enabled, interval ${intervalMs}ms`);

  const tick = () => {
    if (schedulerRunning) {
      console.log("[scheduler] previous run still active, skipping tick");
      return;
    }
    schedulerRunning = true;

    try {
      console.log("[scheduler] running ingest + summarize...");
      const started = runPipelineAsync("scheduler");
      if (!started.ok) {
        console.log(`[scheduler] skip: ${started.reason}`);
      } else {
        console.log("[scheduler] pipeline started");
      }
    } catch (e) {
      console.error("[scheduler] error:", e?.message || e);
    } finally {
      schedulerRunning = false;
    }
  };

  // run once shortly after boot, then interval
  setTimeout(tick, 5000);
  setInterval(tick, intervalMs);
}

/* -------------------- Start server -------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startScheduler();
});