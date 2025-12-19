// scripts/run_pipeline.js
require("dotenv").config();

const Parser = require("rss-parser");
const { db } = require("../src/db");
const feeds = require("../src/feeds");
const { summarizeWithOpenAI } = require("../src/summarize");
const { canUseOne, recordUse, getState, STATE_PATH } = require("../src/rateLimit");

const parser = new Parser({ timeout: 15000 });

const BATCH_LIMIT = Number(process.env.SUMMARY_BATCH_LIMIT || 10);
const DAILY_CAP = Number(process.env.SUMMARY_DAILY_CAP || 30);
const COOLDOWN_MS = Number(process.env.SUMMARY_COOLDOWN_MS || 1200);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function extractDomain(u) {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function ingest() {
  const insert = db.prepare(`
    INSERT INTO articles (category, source_name, source_url, source_domain, title, url, published_at)
    VALUES (@category, @source_name, @source_url, @source_domain, @title, @url, @published_at)
  `);

  let inserted = 0;

  for (const f of feeds) {
    try {
      const feed = await parser.parseURL(f.url);
      const items = feed.items || [];

      for (const it of items) {
        const title = (it.title || "").trim();
        const url = (it.link || "").trim();
        if (!title || !url) continue;

        const published =
          it.isoDate || it.pubDate || it.published || null;

        try {
          insert.run({
            category: f.category || null,
            source_name: f.name || null,
            source_url: f.url || null,
            source_domain: extractDomain(url),
            title,
            url,
            published_at: published ? String(published) : null,
          });
          inserted++;
        } catch (e) {
          // duplicates ignored (unique url)
        }
      }
    } catch (e) {
      console.error(`Feed failed: ${f.name} -> ${e.message}`);
    }
  }

  console.log(`Ingest done. Inserted ${inserted} new items.`);
  return inserted;
}

async function summarizeBatch() {
  const state = getState();
  console.log(
    `Daily summaries used: ${state.count}/${DAILY_CAP} (state: ${STATE_PATH})`
  );

  if (!canUseOne(DAILY_CAP)) {
    console.log("Daily cap reached. Skipping summarize.");
    return 0;
  }

  const rows = db
    .prepare(
      `
      SELECT id, title, url
      FROM articles
      WHERE summary IS NULL OR summary = ''
      ORDER BY created_at DESC
      LIMIT ?
    `
    )
    .all(BATCH_LIMIT);

  if (!rows.length) {
    console.log("No unsummarized articles.");
    return 0;
  }

  const update = db.prepare(`
    UPDATE articles
    SET summary = ?, summarized_at = datetime('now')
    WHERE id = ?
  `);

  let done = 0;

  for (const r of rows) {
    if (!canUseOne(DAILY_CAP)) {
      console.log("Daily cap reached mid-batch. Stopping.");
      break;
    }

    console.log(`Summarizing: ${r.title}`);

    try {
      const out = await summarizeWithOpenAI({ title: r.title, url: r.url });
      update.run(out, r.id);
      recordUse();
      done++;
      console.log("✓ saved");
    } catch (e) {
      console.error(`✗ failed: ${e.message}`);
    }

    await sleep(COOLDOWN_MS);
  }

  return done;
}

async function run() {
  console.log("Running ingest...");
  await ingest();
  console.log("Running summarize...");
  await summarizeBatch();
  console.log("Pipeline complete.");
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Pipeline fatal error:", e);
    process.exit(1);
  });