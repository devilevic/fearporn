// server.js
require("dotenv").config();

const path = require("path");
const express = require("express");
const { spawnSync } = require("child_process");

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
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* -------------------- API -------------------- */
app.get("/api/articles", (req, res) => {
  try {
    const rows = db
      .prepare(
        `
        SELECT
          id,
          category,
          title,
          url,
          source_name,
          source_domain,
          published_at,
          created_at,
          summarized_at,
          summary
        FROM articles
        WHERE summary IS NOT NULL AND summary != ''
        ORDER BY summarized_at DESC
        LIMIT 50
      `
      )
      .all();

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* -------------------- Frontend -------------------- */
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

/* -------------------- Optional admin trigger -------------------- */
if (process.env.ENABLE_ADMIN_RUN === "true") {
  app.get("/admin/run", (req, res) => {
    try {
      const token = req.query.token || req.get("x-admin-token");
      if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
        return res.status(401).send("Unauthorized");
      }
      const result = runPipeline();
      if (!result.ok) return res.status(500).json(result);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).send(e.message);
    }
  });
}

/* -------------------- Pipeline runner -------------------- */
function runScript(scriptPath) {
  const r = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return {
    status: r.status,
    stdout: (r.stdout || "").slice(-8000),
    stderr: (r.stderr || "").slice(-8000),
  };
}

function runPipeline() {
  const ingest = runScript("scripts/ingest.js");
  if (ingest.status !== 0) {
    return { ok: false, step: "ingest", ...ingest };
  }

  const summarize = runScript("scripts/summarize_batch.js");
  if (summarize.status !== 0) {
    return { ok: false, step: "summarize", ...summarize };
  }

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
      const result = runPipeline();
      if (!result.ok) {
        console.error("[scheduler] pipeline failed:", result.step);
        console.error(result.stderr || result.stdout);
      } else {
        console.log("[scheduler] pipeline OK");
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