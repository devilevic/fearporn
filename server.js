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

/* -------------------- API -------------------- */
app.get("/api/articles", (req, res) => {
  try {
    // Only show summarized articles
    const rows = db
      .prepare(
        `
        SELECT id, title, url, category, published_at, created_at, summary, source_domain, source_name
        FROM articles
        WHERE summary IS NOT NULL AND summary != ''
        ORDER BY datetime(created_at) DESC
        LIMIT 5000
      `
      )
      .all();

    res.json(rows);
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