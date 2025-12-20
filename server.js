// server.js
require("dotenv").config();

const express = require("express");
const path = require("path");
const { spawn } = require("child_process");

const db = require("./src/db");

const app = express();
const PORT = process.env.PORT || 10000;

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const DB_PATH = process.env.DB_PATH || "/var/data/data.sqlite";

// -------------------- Static + views --------------------
app.use(express.static(path.join(__dirname, "public"))); // serves /style.css if public/style.css exists
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// simple “is this the deployed version?” endpoint
app.get("/_version", (req, res) => {
  res.type("text").send("VERSION 2025-12-20 pagination");
});

// debug endpoint: confirms DB + counts
app.get("/_debug", (req, res) => {
  try {
    const cols = db
      .prepare(`PRAGMA table_info(articles)`)
      .all()
      .map((r) => r.name);

    const total = db.prepare(`SELECT COUNT(*) as c FROM articles`).get().c;

    const summarized = db
      .prepare(
        `SELECT COUNT(*) as c
         FROM articles
         WHERE summary IS NOT NULL AND TRIM(summary) <> ''`
      )
      .get().c;

    const unsummarized = total - summarized;

    res.json({
      ok: true,
      db_path: DB_PATH,
      columns: cols,
      total,
      summarized,
      unsummarized,
      pipeline: {
        running: !!pipeline.running,
        startedAt: pipeline.startedAt || null,
        lastRunAt: pipeline.lastRunAt || null,
        lastResultOk: pipeline.lastResultOk ?? null,
      },
      scheduler: scheduler.enabled
        ? { enabled: true, interval_ms: scheduler.intervalMs }
        : { enabled: false },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

// -------------------- API: paginated articles --------------------
// GET /api/articles?page=1&limit=10
app.get("/api/articles", (req, res) => {
  try {
    const limitRaw = parseInt(req.query.limit, 10);
    const pageRaw = parseInt(req.query.page, 10);

    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(50, limitRaw)) : 10;
    const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
    const offset = (page - 1) * limit;

    const where = `WHERE summary IS NOT NULL AND TRIM(summary) <> ''`;

    const total = db.prepare(`SELECT COUNT(*) as c FROM articles ${where}`).get().c;
    const pages = Math.max(1, Math.ceil(total / limit));

    const items = db
      .prepare(
        `
        SELECT id, title, url, category, published_at, created_at,
               summary, source_domain, source_name, source_url
        FROM articles
        ${where}
        ORDER BY
          COALESCE(published_at, summarized_at, created_at) DESC,
          id DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(limit, offset);

    res.json({ items, total, page, pages, limit });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

// -------------------- Admin pipeline (ingest + summarize) --------------------
function isAuthed(req) {
  const token = req.query.token || req.get("x-admin-token") || "";
  return ADMIN_TOKEN && token === ADMIN_TOKEN;
}

const pipeline = {
  running: false,
  child: null,
  startedAt: null,
  lastRunAt: null,
  lastResult: null,
  lastResultOk: null,
};

function runNodeScript(label, scriptPath, timeoutMs = 6 * 60 * 1000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [scriptPath], {
      cwd: __dirname,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve({
        label,
        code: null,
        ms: Date.now() - started,
        stdout,
        stderr: stderr + `\n[pipeline:${label}] timeout after ${timeoutMs}ms -> killing child\n`,
      });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        label,
        code,
        ms: Date.now() - started,
        stdout,
        stderr,
      });
    });
  });
}

async function runPipeline(who = "admin") {
  const ingest = await runNodeScript(`${who}:ingest`, path.join(__dirname, "scripts", "ingest.js"));
  if (ingest.code !== 0) return { ok: false, step: "ingest", ingest };

  const summarize = await runNodeScript(
    `${who}:summarize`,
    path.join(__dirname, "scripts", "summarize_batch.js")
  );
  if (summarize.code !== 0) return { ok: false, step: "summarize", ingest, summarize };

  return { ok: true, ingest, summarize };
}

app.get("/admin/run", async (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

  if (pipeline.running) {
    return res.status(409).json({ ok: false, reason: "pipeline already running" });
  }

  pipeline.running = true;
  pipeline.startedAt = Date.now();
  pipeline.lastResult = null;
  pipeline.lastResultOk = null;

  // run async, return immediately
  res.json({ ok: true, started: true });

  try {
    const result = await runPipeline("admin");
    pipeline.lastRunAt = Date.now();
    pipeline.lastResult = { ...result, at: new Date().toISOString() };
    pipeline.lastResultOk = !!result.ok;
  } catch (e) {
    pipeline.lastRunAt = Date.now();
    pipeline.lastResult = { ok: false, error: String(e?.message || e), at: new Date().toISOString() };
    pipeline.lastResultOk = false;
  } finally {
    pipeline.running = false;
    pipeline.startedAt = null;
  }
});

app.get("/admin/status", (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

  res.json({
    pipelineRunning: pipeline.running,
    startedAt: pipeline.startedAt,
    lastRunAt: pipeline.lastRunAt,
    lastResult: pipeline.lastResult,
  });
});

app.get("/admin/reset", (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ ok: false, error: "unauthorized" });

  // we don’t keep a single long-lived child (each script is spawned separately),
  // so reset just clears the lock/state.
  pipeline.running = false;
  pipeline.startedAt = null;

  res.json({ ok: true, reset: true });
});

// -------------------- Scheduler --------------------
const scheduler = {
  enabled: (process.env.SCHEDULER_ENABLED || "true").toLowerCase() === "true",
  intervalMs: parseInt(process.env.SCHEDULER_INTERVAL_MS || "1800000", 10),
  timer: null,
};

async function schedulerTick() {
  if (pipeline.running) {
    console.log("[scheduler] skip: pipeline already running");
    return;
  }
  console.log("[scheduler] starting pipeline...");
  pipeline.running = true;
  pipeline.startedAt = Date.now();

  try {
    const result = await runPipeline("scheduler");
    pipeline.lastRunAt = Date.now();
    pipeline.lastResult = { ...result, at: new Date().toISOString() };
    pipeline.lastResultOk = !!result.ok;
    console.log("[scheduler] pipeline", result.ok ? "OK" : "FAILED");
  } catch (e) {
    pipeline.lastRunAt = Date.now();
    pipeline.lastResult = { ok: false, error: String(e?.message || e), at: new Date().toISOString() };
    pipeline.lastResultOk = false;
    console.log("[scheduler] pipeline FAILED:", e?.message || e);
  } finally {
    pipeline.running = false;
    pipeline.startedAt = null;
  }
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (scheduler.enabled) {
    console.log(`[scheduler] enabled, interval ${scheduler.intervalMs}ms`);
    scheduler.timer = setInterval(schedulerTick, scheduler.intervalMs);
  }
});