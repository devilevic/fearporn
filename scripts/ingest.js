const Parser = require("rss-parser");
const db = require("../src/db");
const feeds = require("../src/feeds");

const parser = new Parser({ timeout: 15000 });

const insert = db.prepare(`
  INSERT INTO articles (source, source_url, title, url, published_at, category)
  VALUES (@source, @source_url, @title, @url, @published_at, @category)
`);

async function run() {
  let inserted = 0;

  for (const f of feeds) {
    try {
      const feed = await parser.parseURL(f.url);
      const items = (feed.items || []).slice(0, 20);

      for (const item of items) {
        const url = item.link?.trim();
        const title = item.title?.trim();
        if (!url || !title) continue;

        try {
          insert.run({
            source: f.name,
            source_url: f.url,
            title,
            url,
            published_at: item.isoDate || item.pubDate || null,
            category: f.category
          });
          inserted++;
        } catch (e) {
          // duplicate url => ignore
        }
      }
    } catch (e) {
      console.error("Feed failed:", f.name, e.message);
    }
  }

  console.log(`Ingest done. Inserted ${inserted} new items.`);
}

run();