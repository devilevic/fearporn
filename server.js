// server.js
require("dotenv").config();

const path = require("path");
const express = require("express");
const { spawn } = require("child_process");

const db = require("./src/db"); // must export a better-sqlite3 db instance
const { getDailyCount, incrementDailyCount, STATE_PATH } = require("./src/rateLimit");

const app = express();
app.use(express.json());

// ---- config ----
const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const DB_PATH = process.env.DB_PATH || "/var/data/data.sqlite";

const SCHEDULER_ENABLED = (process.env.SCHEDULER_ENABLED || "true").toLowerCase() !== "false";
const SCHEDULER_INTERVAL_MS = parseInt(process.env.SCHEDULER_INTERVAL_MS || "1800000", 10); // 30 min default

// ---- static ----
app.use(express.static(path.join(__dirname, "public")));

// ---- helpers ----
function requireAdmin(req, res) {
  const token = req.query.token || req.headers["x-admin-token"];
  if (!ADMIN_TOKEN || token !== ADMIN_TOKEN) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

function clampInt(v, fallback, min, max) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function runChild(label, cmd, args, timeoutMs = 6 * 60 * 1000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve({
        label,
        code: null,
        ms: Date.now() - start,
        stdout,
        stderr: stderr + `\n[pipeline:${label}] timeout after ${timeoutMs}ms -> killing child\n`,
      });
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ label, code, ms: Date.now() - start, stdout, stderr });
    });
  });
}

// ---- version/debug ----
app.get("/_version", (req, res) => {
  res.type("text").send("VERSION 2025-12-20 server.js + scheduler + async pipeline");
});

app.get("/_debug", (req, res) => {
  try {
    const columns = db
      .prepare(`PRAGMA table_info(articles)`)
      .all()
      .map((r) => r.name);

    const total = db.prepare(`SELECT COUNT(*) AS c FROM articles`).get().c;

    const summarized = db
      .prepare(`SELECT COUNT(*) AS c FROM articles WHERE summary IS NOT NULL AND summary != ''`)
      .get().c;

    const unsummarized = total - summarized;

    res.json({
      ok: true,
      db_path: DB_PATH,
      columns,
      total,
      summarized,
      unsummarized,
      pipeline: pipelineState(),
      scheduler: { enabled: SCHEDULER_ENABLED, interval_ms: SCHEDULER_INTERVAL_MS },
    });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ---- API: paginated summarized articles ----
// supports: /api/articles?limit=10&offset=0
app.get("/api/articles", (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 10, 1, 50);
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000_000);

    const rows = db
      .prepare(
        `
        SELECT id, title, url, category, published_at, created_at, summary, source_domain, source_name
        FROM articles
        WHERE summary IS NOT NULL AND summary != ''
        ORDER BY datetime(created_at) DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(limit, offset);

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- HTML ----
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// ---- pipeline lock/state ----
let PIPELINE_LOCK = false;
let PIPELINE_PID = null;
let PIPELINE_STARTED_AT = null;

let LAST_RUN_AT = null;
let LAST_RESULT = null;

function pipelineState() {
  return {
    running: PIPELINE_LOCK,
    pid: PIPELINE_PID,
    startedAt: PIPELINE_STARTED_AT,
    lastRunAt: LAST_RUN_AT,
    lastResultOk: LAST_RESULT ? !!LAST_RESULT.ok : null,
  };
}

// ---- pipeline runner ----
async function runPipeline(labelPrefix = "scheduler") {
  if (PIPELINE_LOCK) {
    return { ok: false, reason: "pipeline already running" };
  }

  PIPELINE_LOCK = true;
  PIPELINE_STARTED_AT = Date.now();

  const startedAtIso = new Date().toISOString();
  const result = {
    ok: true,
    at: startedAtIso,
    ingest: null,
    summarize: null,
  };

  try {
    // ingest
    PIPELINE_PID = "ingest";
    result.ingest = await runChild(`${labelPrefix}:ingest`, "node", ["scripts/ingest.js"], 6 * 60 * 1000);
    if (result.ingest.code !== 0) {
      result.ok = false;
      return result;
    }

    // summarize
    PIPELINE_PID = "summarize";
    result.summarize = await runChild(`${labelPrefix}:summarize`, "node", ["scripts/summarize_batch.js"], 6 * 60 * 1000);
    if (result.summarize.code !== 0) {
      result.ok = false;
      return result;
    }

    return result;
  } finally {
    LAST_RUN_AT = Date.now();
    LAST_RESULT = result;

    PIPELINE_LOCK = false;
    PIPELINE_PID = null;
    PIPELINE_STARTED_AT = null;
  }
}

// ---- admin endpoints ----
app.get("/admin/run", async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const r = await runPipeline("admin");
  if (r.ok === false && r.reason === "pipeline already running") {
    return res.status(409).json({ ok: false, reason: r.reason });
  }
  res.json(r.ok ? { ok: true, started: true } : { ok: false, result: r });
});

app.get("/admin/status", (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({
    pipelineRunning: PIPELINE_LOCK,
    pid: PIPELINE_PID,
    startedAt: PIPELINE_STARTED_AT,
    lastRunAt: LAST_RUN_AT,
    lastResult: LAST_RESULT,
  });
});

app.get("/admin/reset", (req, res) => {
  if (!requireAdmin(req, res)) return;
  // This only resets the lock; use with care.
  PIPELINE_LOCK = false;
  PIPELINE_PID = null;
  PIPELINE_STARTED_AT = null;
  res.json({ ok: true, reset: true });
});

// ---- scheduler ----
if (SCHEDULER_ENABLED) {
  console.log(`[scheduler] enabled, interval ${SCHEDULER_INTERVAL_MS}ms`);
  setInterval(async () => {
    if (PIPELINE_LOCK) {
      console.log("[scheduler] skip: pipeline already running");
      return;
    }
    console.log("[scheduler] starting pipeline...");
    const r = await runPipeline("scheduler");
    console.log(r.ok ? "[scheduler] pipeline OK" : "[scheduler] pipeline FAILED");
  }, SCHEDULER_INTERVAL_MS);
}

// ---- start ----
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});