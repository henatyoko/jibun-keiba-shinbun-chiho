// バックテスト用に、地方競馬情報サイト(keiba.go.jp)の月次ファイルを複数ヶ月分まとめて
// ダウンロードし、レース単位にマージしてローカルの history/ 以下にJSONで保存するスクリプト。
// 表示アプリ(Supabase Edge Function)とは別系統。手元で `node scripts/export-history.mjs` を叩いて使う。
//
// 使い方:
//   node scripts/export-history.mjs --months 12        # 直近12ヶ月分(デフォルト)
//   node scripts/export-history.mjs --from 2025-01 --to 2025-12
//   node scripts/export-history.mjs --months 6 --force  # 既存キャッシュを無視して再取得
//
// オッズ(月次)は確定オッズのみでファイルサイズが非常に大きいため取得しない。
// 払戻金(payback.csv)は取得するので、単勝的中時の実際の配当は分かる。

import AdmZip from "adm-zip";
import { parse } from "csv-parse/sync";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "history");
const BASE = "https://www.keiba.go.jp/KeibaWeb/DataDownload";

function parseArgs(argv) {
  const args = { months: 12, force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--months") args.months = Number(argv[++i]);
    else if (argv[i] === "--from") args.from = argv[++i];
    else if (argv[i] === "--to") args.to = argv[++i];
    else if (argv[i] === "--force") args.force = true;
  }
  return args;
}

function monthRange({ months, from, to }) {
  const list = [];
  if (from && to) {
    let [y, m] = from.split("-").map(Number);
    const [toY, toM] = to.split("-").map(Number);
    while (y < toY || (y === toY && m <= toM)) {
      list.push({ year: y, month: m });
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return list;
  }
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    list.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return list;
}

async function downloadZip(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; chihou-keiba-shinbun-export/1.0)" },
  });
  if (!res.ok) throw new Error(`download failed: ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(buf);
  const files = {};
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    files[entry.entryName] = entry.getData();
  }
  return files;
}

function findEntry(files, suffix) {
  const key = Object.keys(files).find((name) => name.endsWith(suffix));
  return key ? files[key] : null;
}

function parseCsv(buffer) {
  if (!buffer) return [];
  return parse(buffer, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
}

function mergeRaces({ racelist, horselist, payback }) {
  const keyOf = (venue, no, date) => `${date}_${venue}_${no}`;

  const horsesByKey = {};
  horselist.forEach((h) => {
    const key = keyOf(h["競馬場"], h["レース番号"], h["競走年月日"]);
    (horsesByKey[key] ||= []).push(h);
  });

  const paybackByKey = {};
  payback.forEach((p) => {
    paybackByKey[keyOf(p["競馬場"], p["レース番号"], p["競走年月日"])] = p;
  });

  return racelist
    .map((race) => {
      const key = keyOf(race["競馬場"], race["レース番号"], race["競走年月日"]);
      const horses = (horsesByKey[key] || [])
        .slice()
        .sort((a, b) => Number(a["馬番"]) - Number(b["馬番"]))
        .map((h) => ({
          waku: Number(h["枠番"]),
          umaban: Number(h["馬番"]),
          name: h["馬名"],
          sex: h["性"],
          age: Number(h["齢"]),
          sire: h["父馬名"],
          dam: h["母馬名"],
          damsire: h["母父馬名"],
          jockey: h["騎手名"],
          trainer: h["調教師"],
          weight: h["負担重量"],
          bodyWeight: h["馬体重"],
          bodyWeightDiff: h["馬体重増減"],
          overallStats: h["全成績"],
          trackStats: h["当競馬場成績"],
          distanceStats: h["うち当距離成績"],
          result: h["着順"] || null,
          time: h["タイム"] || null,
          last3f: h["上がり3F"] || null,
          ninki: h["人気"] || null,
        }));

      return {
        id: key,
        venue: race["競馬場"],
        date: race["競走年月日"],
        raceNumber: Number(race["レース番号"]),
        name: race["レース名"],
        surface: race["芝ダート区分"],
        distance: Number(race["距離"]) || null,
        condition: race["馬場"],
        headCount: Number(race["頭数"]) || horses.length,
        entryCondition: race["条件"],
        payback: paybackByKey[key] || null,
        horses,
      };
    })
    .filter((r) => r.horses.length > 0);
}

async function exportMonth(year, month, force) {
  const key = `${year}${String(month).padStart(2, "0")}`;
  const outPath = path.join(OUT_DIR, `${key}.json`);

  if (!force) {
    try {
      await access(outPath);
      console.log(`skip ${key} (既に取得済み。--force で再取得)`);
      return;
    } catch {
      // not cached yet, continue
    }
  }

  console.log(`fetching ${key} ...`);
  const raceFiles = await downloadZip(`${BASE}/RaceDataDownload?type=monthly&k_year=${year}&k_month=${month}`);
  const racelist = parseCsv(findEntry(raceFiles, "_racelist.csv"));
  const horselist = parseCsv(findEntry(raceFiles, "_horselist.csv"));
  const payback = parseCsv(findEntry(raceFiles, "_payback.csv"));
  const races = mergeRaces({ racelist, horselist, payback });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(outPath, JSON.stringify(races));
  console.log(`saved ${key}: ${races.length}レース -> ${path.relative(process.cwd(), outPath)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const months = monthRange(args);
  console.log(`対象: ${months.map((m) => `${m.year}-${String(m.month).padStart(2, "0")}`).join(", ")}`);

  for (const { year, month } of months) {
    try {
      await exportMonth(year, month, args.force);
    } catch (err) {
      console.error(`${year}-${month}: 失敗 -`, err.message);
    }
    await new Promise((r) => setTimeout(r, 1000)); // サイトへの連続アクセスを避けるための小休止
  }
  console.log("完了");
}

main();
