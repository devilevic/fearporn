// scripts/ingest.js
const Parser = require("rss-parser");
const db = require("../src/db");
const feeds = require("../src/feeds");

const parser = new Parser();

// Hard timeout RSS download (prevents “hung forever”)
async function fetchTextWithTimeout(url, ms = 20000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent": "fearporn/1.0 (+https://fearporn.onrender.com)",
        accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

const insert = db.prepare(`
  INSERT INTO articles (source_name, source_domain, source_url, title, url, published_at, category, created_at)
  VALUES (@source_name, @source_domain, @source_url, @title, @url, @published_at, @category, datetime('now'))
`);

function hostnameOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function run() {
  let inserted = 0;

  for (const f of feeds) {
    try {
      const xml = await fetchTextWithTimeout(f.url, 20000);
      const feed = await parser.parseString(xml);

      const items = (feed.items || []).slice(0, 25);

      for (const item of items) {
        const url = item.link?.trim();
        const title = item.title?.trim();
        if (!url || !title) continue;

        // published date (best-effort)
        const published =
          item.isoDate ||
          item.pubDate ||
          item.published ||
          item.date ||
          null;

        try {
          insert.run({
            source_name: f.name,
            source_domain: hostnameOf(url) || hostnameOf(f.url) || f.name,
            source_url: f.url,
            title,
            url,
            published_at: published ? new Date(published).toISOString() : null,
            category: f.category || "news",
          });
          inserted++;
        } catch (e) {
          // likely duplicate url => ignore
        }
      }
    } catch (e) {
      const msg = e?.name === "AbortError" ? "timeout" : e.message;
      console.error("Feed failed:", f.name, msg);
    }
  }

  console.log(`Ingest done. Inserted ${inserted} new items.`);
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Ingest crashed:", e?.message || e);
    process.exit(1);
  });