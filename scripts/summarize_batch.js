require("dotenv").config();
const db = require("../src/db");
const { summarizeWithOpenAI } = require("../src/summarize");
const { getDailyCount, incrementDailyCount, STATE_PATH } = require("../src/rateLimit");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BATCH_LIMIT = Math.max(1, parseInt(process.env.SUMMARY_BATCH_LIMIT || "5", 10));
const DAILY_CAP = Math.max(1, parseInt(process.env.SUMMARY_DAILY_CAP || "100", 10));
const COOLDOWN_MS = Math.max(0, parseInt(process.env.SUMMARY_COOLDOWN_MS || "0", 10));

const select = db.prepare(`
  SELECT id, title, url
  FROM articles
  WHERE summary IS NULL
  ORDER BY created_at DESC
  LIMIT ?
`);

const update = db.prepare(`
  UPDATE articles
  SET summary = ?, summarized_at = datetime('now')
  WHERE id = ?
`);

async function run() {
  let usedToday = getDailyCount();
  console.log(`Daily summaries used: ${usedToday}/${DAILY_CAP} (state: ${STATE_PATH})`);

  if (usedToday >= DAILY_CAP) {
    console.log("Daily cap reached. Skipping summarization.");
    return;
  }

  const rows = select.all(BATCH_LIMIT);
  if (rows.length === 0) {
    console.log("No unsummarized articles.");
    return;
  }

  for (const r of rows) {
    usedToday = getDailyCount();
    if (usedToday >= DAILY_CAP) {
      console.log("Daily cap reached mid-run. Stopping.");
      break;
    }

    try {
      console.log("Summarizing:", r.title);
      const summary = await summarizeWithOpenAI({ title: r.title, url: r.url });
      update.run(summary, r.id);

      incrementDailyCount(1);
      console.log("✓ saved");

      if (COOLDOWN_MS > 0) await sleep(COOLDOWN_MS);
    } catch (e) {
      console.error("✗ failed:", e.message);
      if (COOLDOWN_MS > 0) await sleep(COOLDOWN_MS);
    }
  }
}

run();