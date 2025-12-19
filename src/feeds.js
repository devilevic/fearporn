// src/feeds.js
// Note: RSS URLs sometimes change. If any feed returns errors/0 items, open the site and search "RSS"
// and swap the URL for the current one.

module.exports = [

  // --- Center-right / right-leaning (pick your preferred mix) ---
  // WSJ (often RSS is on feeds.a.dj.com; if one fails, search “WSJ RSS” and swap)
  { name: "WSJ World News",        url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml",     category: "world" },
  { name: "WSJ U.S. Business",     url: "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml",category: "business" },

  // The Hill (center-ish, often right-leaning audience)
  { name: "The Hill",              url: "https://thehill.com/feed/",                       category: "politics" },

  // National Review (right-leaning commentary; verify their current RSS if needed)
  { name: "National Review",       url: "https://www.nationalreview.com/feed/",            category: "politics" },

  // Reason (libertarian / center-right-ish depending on topic)
  { name: "Reason",                url: "https://reason.com/latest/feed/",                 category: "politics" },

  // Washington Examiner (right-leaning)
  { name: "Washington Examiner",   url: "https://www.washingtonexaminer.com/rss",          category: "politics" },

  // New York Post (right-leaning tabloid; optional)
  { name: "New York Post",         url: "https://nypost.com/feed/",                         category: "world" },

  // --- Tech (generally less partisan; keep if you like the tech coverage) ---
  { name: "The Verge",             url: "https://www.theverge.com/rss/index.xml",          category: "tech" },
];