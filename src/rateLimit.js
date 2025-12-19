const fs = require("fs");
const path = require("path");

const STATE_PATH = process.env.RATE_STATE_PATH
  ? process.env.RATE_STATE_PATH
  : path.join(__dirname, "..", "rate_state.json");

function todayKey() {
  // local date key, e.g. 2025-12-14
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { day: todayKey(), count: 0 };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

function getDailyCount() {
  const state = loadState();
  const day = todayKey();
  if (state.day !== day) {
    const reset = { day, count: 0 };
    saveState(reset);
    return 0;
  }
  return state.count || 0;
}

function incrementDailyCount(by = 1) {
  const state = loadState();
  const day = todayKey();
  if (state.day !== day) {
    state.day = day;
    state.count = 0;
  }
  state.count = (state.count || 0) + by;
  saveState(state);
  return state.count;
}

module.exports = { getDailyCount, incrementDailyCount, STATE_PATH };