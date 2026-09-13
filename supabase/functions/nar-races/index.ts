// 地方競馬情報サイト(keiba.go.jp)のデータダウンロード機能からレース情報・オッズを取得し、
// レース単位にマージして返すEdge Function。ブラウザから直接keiba.go.jpを叩くとCORSで
// 弾かれるため、この関数がサーバー側で代わりに取得する。DBは使わず、毎回その場で取得・パースする。
//
// 地方競馬CSVには馬の一意なID(JV-Dataの血統登録番号のようなもの)が無いため、
// 「馬名+生年月日」を複合キーにして、対象月+前月の月次ファイルから各馬の直近走を
// 拾い集める(過去走の着順・タイム・上がり3Fを予想スコアの材料にするため)。

import JSZip from "npm:jszip@3.10.1";
import { parse } from "npm:csv-parse@5/sync";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "https://www.keiba.go.jp/KeibaWeb/DataDownload";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  let date: string | undefined;
  try {
    const body = await req.json();
    date = body?.date;
  } catch {
    // ignore, validated below
  }

  if (!date || !/^\d{8}$/.test(date)) {
    return json({ error: "date(YYYYMMDD)が必要です" }, 400);
  }

  try {
    const races = await getRacesForDate(date);
    return json({ date, races }, 200);
  } catch (err) {
    console.error(err);
    return json(
      { error: "地方競馬情報サイトからのデータ取得に失敗しました", detail: String((err as Error)?.message ?? err) },
      502
    );
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function todayStr(): string {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

function prevYearMonth(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

async function downloadZip(url: string): Promise<Record<string, string>> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; chihou-keiba-shinbun/1.0)" },
  });
  if (!res.ok) throw new Error(`NAR download failed: ${res.status} ${url}`);
  const buf = await res.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const files: Record<string, string> = {};
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    files[name] = await entry.async("string");
  }
  return files;
}

function findEntry(files: Record<string, string>, suffix: string): string | null {
  const key = Object.keys(files).find((name) => name.endsWith(suffix));
  return key ? files[key] : null;
}

function parseCsv(text: string | null): Record<string, string>[] {
  if (!text) return [];
  return parse(text, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
}

// 過去走の材料集め用の軽量パース。月次ファイルは1万行超あり、全カラムを保持すると
// Edge Functionのメモリ上限(WORKER_RESOURCE_LIMIT)に達するため、使う列だけに絞る。
function parseCsvColumns(text: string | null, wanted: string[]): Record<string, string>[] {
  if (!text) return [];
  const wantedSet = new Set(wanted);
  return parse(text, {
    columns: (header: string[]) => header.map((h) => (wantedSet.has(h) ? h : undefined)),
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
}

const HISTORY_HORSE_COLUMNS = ["競馬場", "競走年月日", "レース番号", "馬名", "生年月日", "着順", "タイム", "上がり3F", "人気"];
const HISTORY_RACE_COLUMNS = ["競馬場", "競走年月日", "レース番号", "1着賞金(円)", "2着賞金(円)", "3着賞金(円)", "4着賞金(円)", "5着賞金(円)"];

type RaceFiles = {
  racelist: Record<string, string>[];
  horselist: Record<string, string>[];
  payback: Record<string, string>[];
  odds?: Record<string, string>[];
};

type PastRun = { date: string; result: string; time: string; last3f: string; ninki: string; money: number };
type MonthlyRaceHorse = { racelist: Record<string, string>[]; horselist: Record<string, string>[] };

async function fetchDaily(): Promise<RaceFiles> {
  const [raceFiles, oddsFiles] = await Promise.all([
    downloadZip(`${BASE}/RaceDataDownload?type=daily`),
    downloadZip(`${BASE}/OddsDataDownload?type=daily`),
  ]);
  return {
    racelist: parseCsv(findEntry(raceFiles, "_racelist.csv")),
    horselist: parseCsv(findEntry(raceFiles, "_horselist.csv")),
    payback: parseCsv(findEntry(raceFiles, "_payback.csv")),
    odds: parseCsv(findEntry(oddsFiles, "_odds.csv")),
  };
}

// 月次ファイル: 指定した年月のレース情報を取得。オッズは確定オッズのみ・巨大なため取得しない
// (過去レースの配当はpayback.csvで足りる)。
async function fetchMonthly(year: number, month: number): Promise<RaceFiles> {
  const raceFiles = await downloadZip(`${BASE}/RaceDataDownload?type=monthly&k_year=${year}&k_month=${month}`);
  return {
    racelist: parseCsv(findEntry(raceFiles, "_racelist.csv")),
    horselist: parseCsv(findEntry(raceFiles, "_horselist.csv")),
    payback: parseCsv(findEntry(raceFiles, "_payback.csv")),
  };
}

// 過去走の材料集め専用(対象月+前月)。出馬表(着順)だけ取れれば足りる。
// 賞金額による重み付け(レース一覧も追加取得)も試したが、Edge Functionの
// リソース上限(WORKER_RESOURCE_LIMIT)に達して本番が完全に落ちる一方、
// バックテストでは着順ベースと的中率がほぼ変わらなかったため、出馬表のみに戻した。
async function fetchMonthlyRaceAndHorse(year: number, month: number): Promise<MonthlyRaceHorse> {
  const raceFiles = await downloadZip(`${BASE}/RaceDataDownload?type=monthly&k_year=${year}&k_month=${month}`);
  return {
    racelist: [],
    horselist: parseCsvColumns(findEntry(raceFiles, "_horselist.csv"), HISTORY_HORSE_COLUMNS),
  };
}

function horseKey(name: string, birth: string) {
  return `${name}|${birth}`;
}

function raceKeyOf(venue: string, date: string, no: string) {
  return `${venue}_${date}_${no}`;
}

// レース一覧から「そのレースの着順ごとの賞金額」の索引を作る(1〜5着賞金(円))。
function buildPrizeLookup(racelistRows: Record<string, string>[]): Record<string, number[]> {
  const map: Record<string, number[]> = {};
  racelistRows.forEach((r) => {
    const key = raceKeyOf(r["競馬場"], r["競走年月日"], r["レース番号"]);
    map[key] = [1, 2, 3, 4, 5].map((n) => Number(r[`${n}着賞金(円)`]) || 0);
  });
  return map;
}

// horselist行の集まりから、馬名+生年月日をキーに「対象日より前に確定した過去走」を集める。
// 賞金額(money)はprizeLookupから引く(無ければ0=着外相当として扱う)。
function buildHistoryMap(rows: Record<string, string>[], prizeLookup: Record<string, number[]>, beforeDate: string): Record<string, PastRun[]> {
  const map: Record<string, PastRun[]> = {};
  rows.forEach((h) => {
    const date = h["競走年月日"];
    const result = h["着順"];
    const finish = Number(result);
    if (!date || date >= beforeDate) return;
    if (!Number.isFinite(finish) || finish <= 0) return;
    const key = horseKey(h["馬名"], h["生年月日"]);
    const prizes = prizeLookup[raceKeyOf(h["競馬場"], date, h["レース番号"])];
    const money = prizes && finish <= 5 ? prizes[finish - 1] : 0;
    (map[key] ||= []).push({ date, result, time: h["タイム"], last3f: h["上がり3F"], ninki: h["人気"], money });
  });
  Object.values(map).forEach((runs) => runs.sort((a, b) => (a.date < b.date ? 1 : -1)));
  return map;
}

function mergeRaces(
  { racelist, horselist, odds = [], payback = [] }: RaceFiles,
  targetDate: string,
  historyMap: Record<string, PastRun[]>
) {
  const races = racelist.filter((r) => r["競走年月日"] === targetDate);
  const keyOf = (venue: string, no: string) => `${venue}_${no}`;

  const horsesByKey: Record<string, Record<string, string>[]> = {};
  horselist
    .filter((h) => h["競走年月日"] === targetDate)
    .forEach((h) => {
      const key = keyOf(h["競馬場"], h["レース番号"]);
      (horsesByKey[key] ||= []).push(h);
    });

  const oddsByKey: Record<string, Record<string, { odds: string; ninki: string }>> = {};
  odds
    .filter((o) => o["競走年月日"] === targetDate && o["賭式"] === "単勝")
    .forEach((o) => {
      const key = keyOf(o["競馬場"], o["レース番号"]);
      (oddsByKey[key] ||= {})[o["番号1"]] = { odds: o["オッズ"], ninki: o["人気"] };
    });

  const paybackByKey: Record<string, Record<string, string>> = {};
  payback
    .filter((p) => p["競走年月日"] === targetDate)
    .forEach((p) => {
      paybackByKey[keyOf(p["競馬場"], p["レース番号"])] = p;
    });

  return races
    .map((race) => {
      const key = keyOf(race["競馬場"], race["レース番号"]);
      const horses = (horsesByKey[key] || [])
        .slice()
        .sort((a, b) => Number(a["馬番"]) - Number(b["馬番"]))
        .map((h) => {
          const liveOdds = oddsByKey[key]?.[h["馬番"]];
          const pastRaces = (historyMap[horseKey(h["馬名"], h["生年月日"])] || []).slice(0, 5);
          return {
            waku: Number(h["枠番"]),
            umaban: Number(h["馬番"]),
            name: h["馬名"],
            sex: h["性"],
            age: Number(h["齢"]),
            sire: h["父馬名"],
            dam: h["母馬名"],
            damsire: h["母父馬名"],
            jockey: h["騎手名"],
            jockeyAffil: h["騎手所属"],
            weight: h["負担重量"],
            jockeyStats: h["騎手成績"],
            trainer: h["調教師"],
            trainerAffil: h["調教師所属"],
            owner: h["馬主氏名"],
            breeder: h["生産牧場名"],
            bodyWeight: h["馬体重"],
            bodyWeightDiff: h["馬体重増減"],
            overallStats: h["全成績"],
            trackStats: h["当競馬場成績"],
            distanceStats: h["うち当距離成績"],
            bestTime: h["最高タイム"],
            odds: liveOdds?.odds || null,
            ninki: liveOdds?.ninki || h["人気"] || null,
            result: h["着順"] || null,
            time: h["タイム"] || null,
            margin: h["着差"] || null,
            last3f: h["上がり3F"] || null,
            pastRaces,
          };
        });

      return {
        id: `${targetDate}_${race["競馬場"]}_${race["レース番号"]}`,
        venue: race["競馬場"],
        date: targetDate,
        raceNumber: Number(race["レース番号"]),
        postTime: race["発走時刻"],
        kind: race["競走種類名称"],
        name: race["レース名"],
        surface: race["芝ダート区分"],
        turn: race["回り"],
        distance: Number(race["距離"]) || null,
        weather: race["天候"],
        condition: race["馬場"],
        headCount: Number(race["頭数"]) || horses.length,
        entryCondition: race["条件"],
        isFinished: horses.some((h) => h.result),
        payback: paybackByKey[key] || null,
        horses,
      };
    })
    .sort((a, b) => (a.venue === b.venue ? a.raceNumber - b.raceNumber : a.venue.localeCompare(b.venue, "ja")));
}

async function getRacesForDate(dateStr: string) {
  const isToday = dateStr === todayStr();
  const year = Number(dateStr.slice(0, 4));
  const month = Number(dateStr.slice(4, 6));
  const prev = prevYearMonth(year, month);

  // 過去走は「対象月と同じ月次ファイル(当日の場合は別途取得が要る)」+「前月分」から集める。
  // Edge Functionのメモリ上限に収めるため、重い月次取得は並列にせず順番に行う
  // (複数のZIP解凍・大きな配列を同時にメモリ上に持たないようにする)。
  const files = isToday ? await fetchDaily() : await fetchMonthly(year, month);
  const prevMonthData = await fetchMonthlyRaceAndHorse(prev.year, prev.month);
  const currentMonthData = isToday ? await fetchMonthlyRaceAndHorse(year, month) : null;

  const historyHorseRows = currentMonthData ? [...prevMonthData.horselist, ...currentMonthData.horselist] : [...prevMonthData.horselist, ...files.horselist];
  const historyRaceRows = currentMonthData ? [...prevMonthData.racelist, ...currentMonthData.racelist] : [...prevMonthData.racelist, ...files.racelist];
  const prizeLookup = buildPrizeLookup(historyRaceRows);
  const historyMap = buildHistoryMap(historyHorseRows, prizeLookup, dateStr);

  return mergeRaces(files, dateStr, historyMap);
}
