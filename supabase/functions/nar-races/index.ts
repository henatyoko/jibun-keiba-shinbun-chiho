// 地方競馬情報サイト(keiba.go.jp)のデータダウンロード機能からレース情報・オッズを取得し、
// レース単位にマージして返すEdge Function。ブラウザから直接keiba.go.jpを叩くとCORSで
// 弾かれるため、この関数がサーバー側で代わりに取得する。DBは使わず、毎回その場で取得・パースする
// (当日ファイルは約40KB、月次ファイルも数MB程度でEdge Function内で十分に完結する)。

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

type RaceFiles = {
  racelist: Record<string, string>[];
  horselist: Record<string, string>[];
  payback: Record<string, string>[];
  odds?: Record<string, string>[];
};

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

function mergeRaces({ racelist, horselist, odds = [], payback = [] }: RaceFiles, targetDate: string) {
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

  const files = isToday ? await fetchDaily() : await fetchMonthly(year, month);
  return mergeRaces(files, dateStr);
}
