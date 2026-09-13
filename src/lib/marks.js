const CYCLE = ["", "◎", "○", "▲", "△", "✕"];
const STORAGE_KEY = "chihou-keiba-marks";

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeAll(marks) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(marks));
}

export function getMark(raceId, umaban) {
  const marks = readAll();
  return marks[`${raceId}_${umaban}`] || "";
}

export function cycleMark(raceId, umaban) {
  const marks = readAll();
  const key = `${raceId}_${umaban}`;
  const current = marks[key] || "";
  const next = CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];
  if (next) marks[key] = next;
  else delete marks[key];
  writeAll(marks);
  return next;
}
