const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export function todayStr() {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

export function toDateObj(dateStr) {
  return new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T00:00:00+09:00`);
}

export function formatDate(dateStr) {
  const d = toDateObj(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAYS[d.getDay()]})`;
}

export function shiftDate(dateStr, days) {
  const d = toDateObj(dateStr);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function formatPostTime(hhmm) {
  if (!hhmm || hhmm.length < 3) return "";
  const padded = hhmm.padStart(4, "0");
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
}

// "1343"(1分34秒3)のような区切りなしのタイム文字列を"1:34.3"に整形する
export function formatRaceTime(raw) {
  if (!raw) return null;
  const digits = String(raw).padStart(4, "0");
  const minute = Number(digits.slice(0, digits.length - 3));
  const seconds = digits.slice(digits.length - 3, digits.length - 1);
  const decisecond = digits.slice(-1);
  return `${minute}:${seconds}.${decisecond}`;
}
