// 地方競馬情報サイト(keiba.go.jp)のデータダウンロード機能からレース情報・オッズを取得し、
// レース単位にマージして返すEdge Function。ブラウザから直接keiba.go.jpを叩くとCORSで
// 弾かれるため、この関数がサーバー側で代わりに取得する。
//
// 過去走(予想スコアの材料)は、CSVをその場で解析するのではなく自前のSupabaseテーブル
// (nar_race_history)から引く。以前はCSVの月次ファイルを都度2ヶ月分ダウンロード・解析
// していたが、Edge Functionのメモリ上限(WORKER_RESOURCE_LIMIT)に達して本番が落ちる
// 問題があり、かつ2ヶ月しか遡れなかった。DBに徐々に蓄積していく方式なら軽量かつ
// 遡れる範囲もほぼ無制限になる。このEdge Function自身が、処理した日の確定済み結果を
// 都度DBに書き足していく(初回バックフィルはローカルスクリプトで別途実施済み)。

import JSZip from "npm:jszip@3.10.1";
import { parse } from "npm:csv-parse@5/sync";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "https://www.keiba.go.jp/KeibaWeb/DataDownload";

// jibun-keiba-shinbun(中央競馬版)と同じSupabaseプロジェクトを使っている。
// JV-Data系テーブル(kyosoba_master2, umagoto_race_joho)・自前のnar_race_historyは
// 誰でもSELECTできる公開ポリシー設定済みなのでanonキーで読める。書き込み(結果の
// 蓄積)だけはservice roleキーを使う(どちらもEdge Function実行環境に自動で渡される)。
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

type PastRun = { date: string; result: string; time: string; last3f: string; ninki: string; money: number; league: "NAR" | "JRA"; raceName?: string };

async function supabaseSelect(table: string, params: string): Promise<Record<string, string>[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) return [];
  return res.json();
}

async function supabaseUpsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
  } catch (err) {
    console.error(`upsert ${table} failed:`, err);
  }
}

function horseKey(name: string, birth: string) {
  return `${name}|${birth}`;
}

function raceKeyOf(venue: string, date: string, no: string) {
  return `${venue}_${date}_${no}`;
}

// 地方競馬CSVには「馬名+生年月日」しか無く通算成績も地方の出走分しか集計されていないため、
// JRAから転入した馬は実際の実力に関わらず「経験の浅い馬」にしか見えない。
// jibun-keiba-shinbun側のJV-Data(kyosoba_master2, umagoto_race_joho)は同じSupabase
// プロジェクトにあるので、馬名+生年月日が完全一致する馬を探し、見つかればJRAでの
// 過去走(着順・賞金・上がり3F)も予想スコアの材料に加える。見つからなくても
// (=地方生え抜きの馬、またはJV-Data同期が止まっている等)実害はなく、そのまま
// 地方の過去走だけで評価する。
async function fetchJraHistoryMap(entrants: { name: string; birth: string }[]): Promise<Record<string, PastRun[]>> {
  try {
    const uniqueNames = [...new Set(entrants.map((e) => e.name).filter(Boolean))];
    if (uniqueNames.length === 0) return {};

    const candidates: Record<string, string>[] = [];
    for (let i = 0; i < uniqueNames.length; i += 100) {
      const batch = uniqueNames.slice(i, i + 100);
      const inList = batch.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",");
      const rows = await supabaseSelect("kyosoba_master2", `bamei=in.(${encodeURIComponent(inList)})&select=bamei,seinengappi,ketto_toroku_bango`);
      candidates.push(...rows);
    }
    if (candidates.length === 0) return {};

    // 生年月日も完全一致するものだけ採用する(同姓同名の別馬を除外するため)。
    const birthByName: Record<string, Set<string>> = {};
    entrants.forEach((e) => (birthByName[e.name] ||= new Set()).add(e.birth));
    const kettoByKey: Record<string, string> = {};
    candidates.forEach((c) => {
      if (birthByName[c.bamei]?.has(c.seinengappi)) {
        kettoByKey[horseKey(c.bamei, c.seinengappi)] = c.ketto_toroku_bango;
      }
    });

    const kettoNumbers = [...new Set(Object.values(kettoByKey))];
    if (kettoNumbers.length === 0) return {};

    const races = await supabaseSelect(
      "umagoto_race_joho",
      `ketto_toroku_bango=in.(${kettoNumbers.join(",")})&kakutei_chakujun=neq.00&select=race_code,ketto_toroku_bango,kakutei_chakujun,kakutoku_honshokin,kohan_3f&order=race_code.desc`
    );

    const byKetto: Record<string, PastRun[]> = {};
    races.forEach((r) => {
      const finish = Number(r["kakutei_chakujun"]);
      if (!Number.isFinite(finish) || finish <= 0) return;
      const date = String(r["race_code"]).slice(0, 8);
      const money = (Number(r["kakutoku_honshokin"]) || 0) * 100; // JV-Dataの賞金は100円単位
      const last3fRaw = Number(r["kohan_3f"]);
      // JV-Dataは上がり3F未計測を"999"(=99.9秒)の番兵値で返すため除外する
      const last3f = Number.isFinite(last3fRaw) && last3fRaw > 0 && last3fRaw < 900 ? String(last3fRaw / 10) : "";
      (byKetto[r["ketto_toroku_bango"]] ||= []).push({ date, result: String(finish), time: "", last3f, ninki: "", money, league: "JRA" });
    });

    const result: Record<string, PastRun[]> = {};
    Object.entries(kettoByKey).forEach(([key, ketto]) => {
      if (byKetto[ketto]?.length) result[key] = byKetto[ketto].slice(0, 5);
    });
    return result;
  } catch (err) {
    console.error("JRA history lookup failed:", err);
    return {};
  }
}

// 自前で蓄積している地方競馬の過去走DB(nar_race_history)から、対象日より前の
// 直近走を引く。CSVを都度解析する方式と違い月をまたいで何年でも遡れる。
async function fetchNarHistoryMap(entrants: { name: string; birth: string }[], beforeDate: string): Promise<Record<string, PastRun[]>> {
  try {
    const uniqueNames = [...new Set(entrants.map((e) => e.name).filter(Boolean))];
    if (uniqueNames.length === 0) return {};

    const birthByName: Record<string, Set<string>> = {};
    entrants.forEach((e) => (birthByName[e.name] ||= new Set()).add(e.birth));

    const rows: Record<string, string>[] = [];
    for (let i = 0; i < uniqueNames.length; i += 100) {
      const batch = uniqueNames.slice(i, i + 100);
      const inList = batch.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(",");
      const params = `bamei=in.(${encodeURIComponent(inList)})&race_date=lt.${beforeDate}&select=bamei,seinengappi,race_date,chakujun,time,agari_3f,ninki,shokin,race_name&order=race_date.desc&limit=1000`;
      const batchRows = await supabaseSelect("nar_race_history", params);
      rows.push(...batchRows);
    }

    const map: Record<string, PastRun[]> = {};
    rows.forEach((r) => {
      if (!birthByName[r["bamei"]]?.has(r["seinengappi"])) return;
      const key = horseKey(r["bamei"], r["seinengappi"]);
      (map[key] ||= []).push({
        date: r["race_date"],
        result: String(r["chakujun"]),
        time: r["time"] || "",
        last3f: r["agari_3f"] || "",
        ninki: r["ninki"] || "",
        money: Number(r["shokin"]) || 0,
        league: "NAR",
        raceName: r["race_name"] || "",
      });
    });
    Object.values(map).forEach((arr) => arr.sort((a, b) => (a.date < b.date ? 1 : -1)));
    return map;
  } catch (err) {
    console.error("NAR history DB lookup failed:", err);
    return {};
  }
}

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

// レース一覧から「そのレースの着順ごとの賞金額」+「レース名」の索引を作る。
// レース名にはクラス表記(例:Ｃ２－５組、Ｂ４－５)が入っているため、クラス変動の
// 判定材料として保存しておく(パース自体はフロント側のscoring.jsで行う)。
function buildRaceInfoLookup(racelistRows: Record<string, string>[]): Record<string, { prizes: number[]; name: string }> {
  const map: Record<string, { prizes: number[]; name: string }> = {};
  racelistRows.forEach((r) => {
    const key = raceKeyOf(r["競馬場"], r["競走年月日"], r["レース番号"]);
    map[key] = {
      prizes: [1, 2, 3, 4, 5].map((n) => Number(r[`${n}着賞金(円)`]) || 0),
      name: r["レース名"] || "",
    };
  });
  return map;
}

// 対象日に確定した結果をnar_race_historyに書き足す。次回以降この日を過去走として
// 引けるようにするため(=DBが使うたびに育っていく)。
async function saveTodayResultsToHistory(
  horselistRows: Record<string, string>[],
  raceInfoLookup: Record<string, { prizes: number[]; name: string }>,
  targetDate: string
) {
  const rows = horselistRows
    .map((h) => {
      const finish = Number(h["着順"]);
      if (!Number.isFinite(finish) || finish <= 0) return null;
      const info = raceInfoLookup[raceKeyOf(h["競馬場"], targetDate, h["レース番号"])];
      const shokin = info && finish <= 5 ? info.prizes[finish - 1] : 0;
      return {
        bamei: h["馬名"],
        seinengappi: h["生年月日"],
        keibajo: h["競馬場"],
        race_date: targetDate,
        race_number: h["レース番号"],
        chakujun: finish,
        time: h["タイム"] || null,
        agari_3f: h["上がり3F"] || null,
        ninki: h["人気"] || null,
        shokin,
        race_name: info?.name || null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  await supabaseUpsert("nar_race_history", rows);
}

function mergeRaces(
  { racelist, horselist, odds = [], payback = [] }: RaceFiles,
  targetDate: string,
  historyMap: Record<string, PastRun[]>,
  jraHistoryMap: Record<string, PastRun[]>
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
          const hKey = horseKey(h["馬名"], h["生年月日"]);
          const pastRaces = [...(historyMap[hKey] || []), ...(jraHistoryMap[hKey] || [])]
            .sort((a, b) => (a.date < b.date ? 1 : -1))
            .slice(0, 5);
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

  const files = isToday ? await fetchDaily() : await fetchMonthly(year, month);

  const targetHorselistRows = files.horselist.filter((h) => h["競走年月日"] === dateStr);
  const entrants = targetHorselistRows.map((h) => ({ name: h["馬名"], birth: h["生年月日"] }));

  const [historyMap, jraHistoryMap] = await Promise.all([
    fetchNarHistoryMap(entrants, dateStr),
    fetchJraHistoryMap(entrants),
  ]);

  const races = mergeRaces(files, dateStr, historyMap, jraHistoryMap);

  // 確定した結果をDBに書き足す(次回以降この日を過去走として引けるようにする)。
  // Edge Functionはレスポンスを返すとバックグラウンド処理が打ち切られることがあるため、
  // 完了を待ってから返す(失敗しても本体のレース情報取得は失敗させない)。
  const targetRacelistRows = files.racelist.filter((r) => r["競走年月日"] === dateStr);
  const targetRaceInfoLookup = buildRaceInfoLookup(targetRacelistRows);
  await saveTodayResultsToHistory(targetHorselistRows, targetRaceInfoLookup, dateStr).catch((err) =>
    console.error("saveTodayResultsToHistory failed:", err)
  );

  return races;
}
