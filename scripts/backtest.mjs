// 本番のnar-races Edge Function経由で実際の確定レースを取得し、今のscoring.jsで
// 印を計算して、的中率と回収率(単勝100円均等買いのシミュレーション)を検証する。
// 「印の付け方を変えたら実際どうなるか」を毎回手作業で調べるのではなく、
// いつでも同じ条件で再現できるようにするためのツール。
//
// 使い方:
//   node scripts/backtest.mjs                      # 直近7日分
//   node scripts/backtest.mjs --days 14             # 直近14日分
//   node scripts/backtest.mjs --from 20260901 --to 20260910
//   node scripts/backtest.mjs --dates 20260912,20260913,20260914

import { scoreRace, computeMarks } from "../src/lib/scoring.js";

const SUPABASE_URL = "https://lbmklokiiobgakuaohgo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_oMfRvXcoRmzxgYJlkzcZ5g_EcTWrpq3";

function parseArgs(argv) {
  const args = { days: 7 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days") args.days = Number(argv[++i]);
    else if (argv[i] === "--from") args.from = argv[++i];
    else if (argv[i] === "--to") args.to = argv[++i];
    else if (argv[i] === "--dates") args.dates = argv[++i].split(",");
  }
  return args;
}

function dateRange(fromStr, toStr) {
  const toDate = (s) => new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00+09:00`);
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const list = [];
  const from = toDate(fromStr);
  const to = toDate(toStr);
  for (let d = from; d <= to; d.setDate(d.getDate() + 1)) list.push(fmt(d));
  return list;
}

function lastNDays(n) {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const list = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    list.push(fmt(d));
  }
  return list;
}

async function fetchRaces(date) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/nar-races`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ date }),
  });
  if (!res.ok) throw new Error(`fetch failed for ${date}: ${res.status}`);
  const data = await res.json();
  return data.races || [];
}

const args = parseArgs(process.argv.slice(2));
const dates = args.dates ?? (args.from && args.to ? dateRange(args.from, args.to) : lastNDays(args.days));

console.log(`対象日: ${dates.join(", ")}\n`);

const MARKS = ["◎", "○", "▲", "△", "穴"];
const stats = {};
MARKS.forEach((m) => (stats[m] = { total: 0, win: 0, top3: 0, staked: 0, returned: 0, placeStaked: 0, placeReturned: 0 }));
let raceCount = 0;
let noMarkCount = 0;

for (const date of dates) {
  let races;
  try {
    races = await fetchRaces(date);
  } catch (err) {
    console.error(`${date}: 取得失敗 (${err.message})`);
    continue;
  }

  races.forEach((race) => {
    if (!race.isFinished) return;
    const scored = scoreRace(race);
    const { marksByUmaban, noDifferentiation } = computeMarks(scored);
    raceCount++;
    if (noDifferentiation) {
      noMarkCount++;
      return;
    }

    const winUmaban = race.payback?.["単勝組番"];
    const winPayout = Number(race.payback?.["単勝払戻金（円）"]) || 0;

    MARKS.forEach((m) => {
      const h = scored.find((h) => marksByUmaban[h.umaban] === m);
      if (!h) return;
      const fin = Number(h.result);
      if (!Number.isFinite(fin) || fin <= 0) return;
      const s = stats[m];
      s.total++;
      if (fin === 1) s.win++;
      if (fin <= 3) s.top3++;

      if (race.payback && winUmaban) {
        s.staked += 100;
        if (String(h.umaban) === String(winUmaban)) s.returned += winPayout;

        s.placeStaked += 100;
        for (let i = 1; i <= 3; i++) {
          const grp = race.payback[`複勝組番${i}`];
          const pay = Number(race.payback[`複勝払戻金${i}（円）`]) || 0;
          if (grp && String(h.umaban) === String(grp)) s.placeReturned += pay;
        }
      }
    });
  });
}

console.log(`集計対象: ${raceCount}レース(印なし${noMarkCount}レース)\n`);
console.log("印  頭数  勝率     複勝率    単勝回収率   複勝回収率");
MARKS.forEach((m) => {
  const s = stats[m];
  if (!s.total) return;
  const winRate = ((s.win / s.total) * 100).toFixed(1);
  const top3Rate = ((s.top3 / s.total) * 100).toFixed(1);
  const winRoi = s.staked ? ((s.returned / s.staked) * 100).toFixed(1) : "-";
  const placeRoi = s.placeStaked ? ((s.placeReturned / s.placeStaked) * 100).toFixed(1) : "-";
  console.log(`${m}  ${String(s.total).padStart(4)}  ${winRate.padStart(6)}%  ${top3Rate.padStart(6)}%   ${String(winRoi).padStart(8)}%   ${String(placeRoi).padStart(8)}%`);
});
