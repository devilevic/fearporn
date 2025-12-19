// src/rateLimit.js
const fs = require("fs");
const path = require("path");

const STATE_PATH =
  process.env.RATE_STATE_PATH || path.join(process.cwd(), "rate_state.json");

function ensureDirForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!dir || dir === "/") return;
  fs.mkdirSync(dir, { recursive: true });
}

function todayKeyUTC() {
  // daily caps are simpler in UTC (avoids “new day” confusion on servers)
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf8");
    const s = JSON.parse(raw);
    if (!s || typeof s !== "object") throw new Error("bad state");
    return s;
  } catch {
    return { day: todayKeyUTC(), count: 0 };
  }
}

function saveState(state) {
  ensureDirForFile(STATE_PATH);
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function getState() {
  const s = loadState();
  const day = todayKeyUTC();
  if (s.day !== day) {
    const reset = { day, count: 0 };
    saveState(reset);
    return reset;
  }
  return s;
}

function canUseOne(dailyCap) {
  const s = getState();
  return s.count < dailyCap;
}

function recordUse() {
  const s = getState();
  s.count += 1;
  saveState(s);
  return s;
}

module.exports = {
  STATE_PATH,
  getState,
  canUseOne,
  recordUse,
};