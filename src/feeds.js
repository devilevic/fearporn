// src/feeds.js
// Note: RSS URLs sometimes change.
// If any feed returns errors/0 items, open the publisher site and search "RSS" and swap the URL.
//
// Goal for fearporn.world:
// - Strong tabloid coverage (NYPost / DailyMail / TheSun) + lots of additional sources.
// - No hard caps here (we ingest everything); any "soft diversity" happens at selection time.

module.exports = [
  /* -------------------- High-volume tabloids -------------------- */
  { name: "New York Post", url: "https://nypost.com/feed/", category: "world" },
  { name: "Daily Mail (News)", url: "https://www.dailymail.co.uk/news/index.rss", category: "world" },
  { name: "Daily Mail (U.S.)", url: "https://www.dailymail.co.uk/ushome/index.rss", category: "world" },
  { name: "The Sun (News)", url: "https://www.thesun.co.uk/news/feed/", category: "world" },

  /* -------------------- Conservative / right-leaning -------------------- */
  { name: "Fox News", url: "https://feeds.foxnews.com/foxnews/latest", category: "world" },
  { name: "Washington Examiner", url: "https://www.washingtonexaminer.com/rss", category: "politics" },
  { name: "National Review", url: "https://www.nationalreview.com/feed/", category: "politics" },
  { name: "The Federalist", url: "https://thefederalist.com/feed/", category: "politics" },
  { name: "Daily Wire", url: "https://www.dailywire.com/feeds/rss.xml", category: "politics" },
  { name: "Just the News", url: "https://justthenews.com/rss.xml", category: "politics" },

  /* -------------------- Libertarian / skeptical / "anti-panic" -------------------- */
  { name: "Reason", url: "https://reason.com/latest/feed/", category: "politics" },
  { name: "Cato Institute", url: "https://www.cato.org/rss.xml", category: "politics" },
  { name: "The American Conservative", url: "https://www.theamericanconservative.com/feed/", category: "politics" },

  /* -------------------- Institutional / business anchors -------------------- */
  // WSJ (feeds.a.dj.com); if one fails, search “WSJ RSS” and swap.
  { name: "WSJ World News", url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml", category: "world" },
  { name: "WSJ U.S. Business", url: "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml", category: "business" },
  // These endpoints can change; swap if needed.
  { name: "Reuters (Top News)", url: "https://feeds.reuters.com/reuters/topNews", category: "world" },
  // AP RSS is a bit inconsistent; if this fails, replace with a working AP RSS endpoint.
  { name: "Associated Press (Top)", url: "https://apnews.com/apf-topnews?output=1", category: "world" },
  { name: "Financial Times (World)", url: "https://www.ft.com/world?format=rss", category: "world" },

  /* -------------------- International / geopolitics -------------------- */
  { name: "The Telegraph", url: "https://www.telegraph.co.uk/rss.xml", category: "world" },
  { name: "Times of Israel", url: "https://www.timesofisrael.com/feed/", category: "world" },
  { name: "Asia Times", url: "https://asiatimes.com/feed/", category: "world" },
  { name: "Al Jazeera (All)", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "world" },

  /* -------------------- Mixed / general (optional) -------------------- */
  { name: "The Hill", url: "https://thehill.com/feed/", category: "politics" },

  /* -------------------- Tech (optional) -------------------- */
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "tech" },
];