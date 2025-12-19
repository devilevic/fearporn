// scripts/ingest.js
const Parser = require("rss-parser");
const db = require("../src/db");
const feeds = require("../src/feeds");

const parser = new Parser({ timeout: 15000 });

const insert = db.prepare(`
  INSERT OR IGNORE INTO articles
    (source_name, source_domain, title, url, published_at, category, created_at)
  VALUES
    (@source_name, @source_domain, @title, @url, @published_at, @category, datetime('now'))
`);

function domainFromUrl(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function run() {
  let insertedCount = 0;

  for (const f of feeds) {
    let feed;
    try {
      feed = await parser.parseURL(f.url);
    } catch (e) {
      console.error(`Feed failed: ${f.name}`, e.message);
      continue;
    }

    for (const item of feed.items || []) {
      const url = item.link || item.guid;
      if (!url) continue;

      const record = {
        source_name: f.name,
        source_domain: domainFromUrl(url),
        title: (item.title || "").trim(),
        url,
        published_at: item.isoDate || item.pubDate || null,
        category: f.category || "world",
      };

      const info = insert.run(record);
      insertedCount += info.changes || 0;
    }
  }

  console.log(`Ingest done. Inserted ${insertedCount} new items.`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});