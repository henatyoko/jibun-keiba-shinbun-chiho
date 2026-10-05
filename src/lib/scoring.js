// 各馬の勝ちやすさを、人気・オッズを使わずに予測する。
//
// 以前は手で決めた点数の足し合わせ(過去走の評価+当場当距離+騎手コンビ+…)だったが、
// 検証すると市場の人気順に遠く及ばなかった(◎勝率20%前後・1番人気は45%)。人気を
// 土台にする方式は精度が高かったが、人気をなぞるだけになり独自の評価ではないため、
// 人気を使わずにデータから勝ちやすさを学習するモデルに置き換えた(model.js)。
// 学習してみると、手作業では見ていなかった「騎手の通算好走率」「調教師の通算好走率」が
// 直近着順・過去走評価と並ぶ主要な材料だった。
//
// 地方競馬の日次/月次CSVには馬の一意なIDが無いため、Edge Function側
// (supabase/functions/nar-races)が「馬名+生年月日」をキーに自前のDBから各馬の直近走
// (pastRaces、最大5走・新しい順)と騎手・調教師の通算成績を拾って渡してくる。
// オッズ・人気(ninki)は表示にだけ使い、予測には一切入れない。

import { FEATURES, MEAN, SD, WEIGHTS } from "./model.js";

export const MARKS = ["◎", "○", "▲", "△", "穴"];

function parseRecord(str) {
  if (!str) return null;
  const parts = str.split("-").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [win, place, show, other] = parts;
  return { win, place, show, other, starts: win + place + show + other };
}

function top3Rate(rec) {
  if (!rec || rec.starts === 0) return null;
  return (rec.win + rec.place + rec.show) / rec.starts;
}

function parseWeight(weightStr) {
  const n = Number(weightStr?.match(/\d+(\.\d+)?/)?.[0]);
  return Number.isFinite(n) ? n : null;
}

// 同じ1着でも重賞優勝と下級条件戦の優勝では価値が全然違うため、着順そのものではなく
// その1走で稼いだ賞金額を点数化する(jibun-keiba-shinbunと同じ考え方)。地方競馬は
// 1着賞金が10万円台〜(交流重賞は数千万円)とJRAよりずっと下のレンジなので、
// 30万円のレース勝ち≒+3点、100万円≒+7点、1000万円級の重賞≒+14点になるよう調整している
// (jibun側のように大量の実戦データで検証した値ではなく、レース格の相場観からの初期値)。
function moneyPointNar(yen) {
  if (!Number.isFinite(yen) || yen <= 0) return null;
  return Math.max(-2, Math.min(16, (Math.log10(yen) - 5) * 7));
}

// JRAは賞金レンジが地方より1〜2桁大きいため、jibun-keiba-shinbun(scoring.js)の
// moneyPointと同じ式を使う(500万円≒+5点、4000万円≒+11点、1億円≒+14点)。
// JRAから転入した馬の過去走(pastRacesにleague:"JRA"で混ざる)に使う。
function moneyPointJra(yen) {
  if (!Number.isFinite(yen) || yen <= 0) return null;
  return Math.max(-2, Math.min(16, (Math.log10(yen) - 6) * 7));
}

// 賞金額が取れない(該当レースが見つからない等)時のフォールバック。着順だけの簡易点。
function financePointFromFinish(finish) {
  if (finish === 1) return 10;
  if (finish === 2) return 6;
  if (finish === 3) return 3;
  if (finish === 4) return 1;
  return Math.max(-2, 1 - (finish - 4) * 0.5);
}

function dateStrToMs(dateStr) {
  if (!dateStr || dateStr.length < 8) return null;
  const y = Number(dateStr.slice(0, 4));
  const m = Number(dateStr.slice(4, 6));
  const d = Number(dateStr.slice(6, 8));
  return Date.UTC(y, m - 1, d);
}

// 当場/当距離の成績が、その馬の通算成績(基準)より良い/悪いかで補正する。
function fitAdjustment(label, statStr, overallRec, weight) {
  const rec = parseRecord(statStr);
  // 2〜3走だけで好走率100%/0%のような極端な値になりやすく、直近の悪い着順を
  // 覆すほどの大きい補正が付いてしまっていた(2走2連対で+9点等)。最低3走に上げ、
  // 縮小率の分母も8に広げて、少ない標本の影響を弱める。
  if (!rec || rec.starts < 3) return null;
  const rate = top3Rate(rec);
  const baseline = (overallRec ? top3Rate(overallRec) : null) ?? 0.3;
  const shrink = Math.min(rec.starts / 8, 1);
  const score = Math.max(-4, Math.min(4, Math.round((rate - baseline) * 15 * shrink * weight)));
  if (score === 0) return null;
  return { label: `${label}${rec.win}-${rec.place}-${rec.show}-${rec.other}`, score };
}

export function trackFitAdjustment(trackStr, overallRec) {
  return fitAdjustment("当場", trackStr, overallRec, 1);
}

export function distanceFitAdjustment(distanceStr, overallRec) {
  return fitAdjustment("当距離", distanceStr, overallRec, 1.2);
}

// jockeyStats(CSVの「騎手成績」)は騎手自身の通算成績ではなく、「この馬にこの騎手が
// 乗った時だけの成績」(同日に同じ騎手が別の馬に乗っていても値が異なることで確認済み)。
// つまり人気が上がる理由の一つである「得意コンビ」「乗り替わりの良し悪し」を直接表す
// 値なので、当場/当距離と同じ考え方(馬の通算成績を基準にした好走率の差分)で補正する。
export function jockeyFitAdjustment(jockeyStatsStr, overallRec) {
  return fitAdjustment("同騎手", jockeyStatsStr, overallRec, 1.5);
}

// 父馬・母父馬ごとの産駒成績(nar_sire_stats/nar_damsire_stats、Edge Function側で
// その日の対象馬の父/母父だけバッチ取得して渡ってくる)を見る。競走馬自身の実績が
// まだ少ない(デビュー間もない・未勝利が続いている等)ほど、市場は血統的な期待値
// (良血統だから人気、というやつ)で評価している比重が大きいと考えられるため、
// 自身の出走数が増えるほどこの補正はフェードさせ、実際の着順の方を優先させる。
// 産駒サンプルが少ない父馬・母父馬(30頭未満)はノイズが大きいため評価しない。
const PEDIGREE_MIN_PROGENY = 30;

function pedigreeSideRate(stats) {
  if (!stats || stats.starts < PEDIGREE_MIN_PROGENY) return null;
  const rec = { win: stats.win, place: stats.place, show: stats.show, other: stats.other, starts: stats.starts };
  return top3Rate(rec);
}

export function pedigreeFitAdjustment(sireStats, damsireStats, horseOwnStarts) {
  const sireRate = pedigreeSideRate(sireStats);
  const damsireRate = pedigreeSideRate(damsireStats);
  if (sireRate == null && damsireRate == null) return null;

  const sireScore = sireRate != null ? (sireRate - 0.3) * 12 : 0;
  const damsireScore = damsireRate != null ? (damsireRate - 0.3) * 12 : 0;
  const weightSum = (sireRate != null ? 0.6 : 0) + (damsireRate != null ? 0.4 : 0);
  if (weightSum === 0) return null;
  const raw = (sireScore * 0.6 + damsireScore * 0.4) / weightSum;

  const fade = Math.max(0, Math.min(1, 1 - (horseOwnStarts ?? 0) / 8));
  const score = Math.max(-3, Math.min(3, Math.round(raw * fade)));
  if (score === 0) return null;
  return { label: "血統適性", score };
}

function toHalfWidth(str) {
  return str.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// 地方競馬のレース名には「Ｃ２－５組」「Ｂ４－５」「Ｃ３三３歳以上」のように
// トラックごとにばらばらな書式でクラス表記が入っている(A/B/C/Dの文字クラス+任意の数字、
// 区切りはダッシュだったり組番の漢数字だったりバラバラ)。「ＪＲＡ認定」のように
// A/B/C/Dを含むが実際はクラス表記ではない文字列もあるため、前後が別の大文字英字
// (＝「ＪＲＡ」のような連続した頭文字語の一部)である場合は候補から除外する。
// 複数のクラス表記が出てくる交流戦等は最後に見つかったものを採用する(ベストエフォート)。
// クラス内の「一組・二組」等の組番も一組の方が格上という序列があるため、
// 文字クラス×100 + 数字×10 + 組番、の合成値にして格上ほど小さい値になるようにする
// (数字・組番とも小さいほど格上)。クラス表記が見つからなければnullを返す。
const CLASS_LETTER_RANK = { A: 0, B: 1, C: 2, D: 3 };

const KANJI_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

export function parseClassRank(raceName) {
  if (!raceName) return null;
  const normalized = toHalfWidth(raceName);
  const isUpper = (ch) => ch != null && /[A-Z]/.test(ch);
  const re = /([ABCD])(\d)?/g;
  let m;
  let result = null;
  while ((m = re.exec(normalized)) !== null) {
    const before = normalized[m.index - 1];
    const afterIdx = m.index + m[0].length;
    const after = normalized[afterIdx];
    if (isUpper(before) || isUpper(after)) continue;
    const classNum = m[2] ? Number(m[2]) : 1;

    // 組番: 「Ｃ３一」のように直後の漢数字、または「Ｃ４－２」のようにダッシュ+数字。
    let group = 0;
    if (after != null && KANJI_NUM[after] != null) {
      group = KANJI_NUM[after] - 1;
    } else if ((after === "-" || after === "－") && /\d/.test(normalized[afterIdx + 1] || "")) {
      group = Number(normalized.slice(afterIdx + 1).match(/^\d+/)[0]) - 1;
    }

    result = CLASS_LETTER_RANK[m[1]] * 100 + classNum * 10 + group;
  }
  return result;
}

const HALF_LIFE_DAYS = 60;

// 直近走(最大5走・新しい順)から、モデルに渡す過去走の特徴量を作る。
function pastFeatures(pastRaces, curDateStr) {
  const empty = { perf: 0, last: 0, avg3: 0, win5: 0, top35: 0, gap: 0, has: 0, agari: 0 };
  const runs = (pastRaces || []).slice(0, 5).filter((r) => Number(r.result) > 0);
  if (!runs.length) return empty;
  const cur = dateStrToMs(curDateStr);
  let ws = 0;
  let wt = 0;
  runs.forEach((r) => {
    const m = r.league === "JRA" ? moneyPointJra(r.money) : moneyPointNar(r.money);
    const point = m != null ? m : financePointFromFinish(Number(r.result));
    const days = Math.max(0, (cur - dateStrToMs(r.date)) / 86400000);
    const w = Math.pow(0.5, days / HALF_LIFE_DAYS);
    ws += point * w;
    wt += w;
  });
  const fin = runs.map((r) => Number(r.result));
  const last3 = fin.slice(0, 3);
  const gapDays = (cur - dateStrToMs(runs[0].date)) / 86400000;
  const ag = runs.map((r) => Number(r.last3f)).filter((v) => v > 0);
  const agari = ag.length >= 2 ? ag.slice(1).reduce((a, b) => a + b, 0) / (ag.length - 1) - ag[0] : 0;
  return {
    perf: wt ? ws / wt : 0,
    last: Math.min(fin[0], 12),
    avg3: Math.min(last3.reduce((a, b) => a + b, 0) / last3.length, 12),
    win5: fin.filter((f) => f === 1).length / fin.length,
    top35: fin.filter((f) => f <= 3).length / fin.length,
    gap: Math.log(1 + gapDays),
    has: 1,
    agari: Math.max(-2, Math.min(2, agari)),
  };
}

// 騎手・調教師の通算好走率。出走数が少ないほど全体平均(3着内30%・勝率10%)寄りに縮める。
const PERSON_SHRINK = 25;
function personRates(agg) {
  const n = agg?.n ?? 0;
  return {
    top3: ((agg?.top3 ?? 0) + 0.3 * PERSON_SHRINK) / (n + PERSON_SHRINK),
    win: ((agg?.win ?? 0) + 0.1 * PERSON_SHRINK) / (n + PERSON_SHRINK),
    n,
  };
}

// モデルに渡す特徴量(FEATURESと同じ並び)を、馬1頭分作る。
function buildFeatures(h, race, ctx) {
  const rec = parseRecord(h.overallStats);
  const overallRec = rec && rec.starts > 0 ? rec : null;
  const pf = pastFeatures(h.pastRaces, race.date);
  const track = trackFitAdjustment(h.trackStats, overallRec)?.score ?? 0;
  const dist = distanceFitAdjustment(h.distanceStats, overallRec)?.score ?? 0;
  const jockeyCombo = jockeyFitAdjustment(h.jockeyStats, overallRec)?.score ?? 0;
  const pedigree = pedigreeFitAdjustment(h.sireStats, h.damsireStats, overallRec?.starts ?? 0)?.score ?? 0;

  let classDiff = 0;
  if (ctx.currentClassRank != null) {
    const pastRanks = (h.pastRaces || [])
      .filter((r) => r.league !== "JRA")
      .map((r) => parseClassRank(r.raceName))
      .filter((v) => v != null);
    if (pastRanks.length) {
      const avg = pastRanks.reduce((a, b) => a + b, 0) / pastRanks.length;
      classDiff = Math.max(-30, Math.min(30, (ctx.currentClassRank - avg) / 10));
    }
  }

  const weight = parseWeight(h.weight);
  const bodyDiff = Number(h.bodyWeightDiff);
  const j = personRates(h.jockeyAgg);
  const t = personRates(h.trainerAgg);
  const values = {
    perf: pf.perf / 5,
    last: pf.last / 5,
    avg3: pf.avg3 / 5,
    win5: pf.win5,
    top35: pf.top35,
    gap: pf.gap / 3,
    has: pf.has,
    agari: pf.agari,
    ovTop3: overallRec ? top3Rate(overallRec) : 0.3,
    ovWin: overallRec ? overallRec.win / overallRec.starts : 0.1,
    ovN: Math.log(1 + (overallRec?.starts ?? 0)) / 3,
    track: track / 4,
    dist: dist / 4,
    jockeyCombo: jockeyCombo / 4,
    pedigree: pedigree / 3,
    classDiff: classDiff / 3,
    jra: (h.pastRaces || []).some((r) => r.league === "JRA") ? 1 : 0,
    wDiff: weight != null && ctx.fieldAvgWeight != null ? (ctx.fieldAvgWeight - weight) / 3 : 0,
    bodyBig: Number.isFinite(bodyDiff) && Math.abs(bodyDiff) >= 15 ? 1 : 0,
    age: (Number(h.age) || 4) / 4,
    female: h.sex === "牝" ? 1 : 0,
    inner: 1 - (Number(h.umaban) - 1) / Math.max(1, ctx.headCount - 1),
    jTop3: j.top3,
    jWin: j.win,
    tTop3: t.top3,
    tWin: t.win,
    jN: Math.log(1 + j.n) / 5,
  };
  return { values, overallRec, classDiff };
}

// 画面に出す理由の表示用に、特徴量を人が読めるグループにまとめる。
const GROUPS = [
  { label: "近走成績", keys: ["perf", "last", "avg3", "win5", "top35", "gap", "has", "agari"] },
  { label: "通算成績", keys: ["ovTop3", "ovWin", "ovN"] },
  { label: "騎手の好走率", keys: ["jTop3", "jWin", "jN"] },
  { label: "調教師の好走率", keys: ["tTop3", "tWin"] },
  { label: "当場", keys: ["track"] },
  { label: "当距離", keys: ["dist"] },
  { label: "同騎手", keys: ["jockeyCombo"] },
  { label: "血統", keys: ["pedigree"] },
  { label: "クラス", keys: ["classDiff"] },
  { label: "JRA実戦経験", keys: ["jra"] },
  { label: "斤量", keys: ["wDiff"] },
  { label: "馬体重", keys: ["bodyBig"] },
  { label: "枠・年齢性別", keys: ["inner", "age", "female"] },
];
// 1ロジット=この点数。◎○▲の点差や△のしきい値(3点)の感覚に合わせたスケール。
const POINTS_PER_LOGIT = 10;
const BASE_POINTS = 70;
const CHIP_MIN_POINTS = 2;

// レース1つ分の出走馬全頭を採点し、合計点(total)の高い順に並べて返す。
export function scoreRace(race) {
  const weights = race.horses.map((h) => parseWeight(h.weight)).filter((w) => w != null);
  const ctx = {
    fieldAvgWeight: weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null,
    currentClassRank: parseClassRank(race.name),
    headCount: race.horses.length,
  };

  const rows = race.horses.map((h) => {
    const { values, overallRec } = buildFeatures(h, race, ctx);
    const z = FEATURES.map((f, i) => (values[f] - MEAN[i]) / SD[i]);
    const logit = z.reduce((a, v, i) => a + v * WEIGHTS[i], 0);
    return { h, values, z, logit, overallRec };
  });

  // レース内で比べる(softmax)ので、全頭の平均を基準にした差で点数・理由を出す。
  const meanLogit = rows.reduce((a, r) => a + r.logit, 0) / rows.length;
  const meanZ = FEATURES.map((_, i) => rows.reduce((a, r) => a + r.z[i], 0) / rows.length);
  const maxLogit = Math.max(...rows.map((r) => r.logit));
  const expSum = rows.reduce((a, r) => a + Math.exp(r.logit - maxLogit), 0);

  const scored = rows.map((r) => {
    const h = r.h;
    const contrib = Object.fromEntries(FEATURES.map((f, i) => [f, WEIGHTS[i] * (r.z[i] - meanZ[i]) * POINTS_PER_LOGIT]));
    const applied = GROUPS.map((g) => {
      const raw = g.keys.reduce((a, k) => a + contrib[k], 0);
      let label = g.label;
      if (g.label === "クラス") label = raw >= 0 ? "クラス格下げ" : "クラス格上げ";
      return { label, score: Math.round(raw) };
    }).filter((a) => Math.abs(a.score) >= CHIP_MIN_POINTS);

    const recordPoints = ["近走成績", "通算成績"].reduce((sum, label) => {
      const g = GROUPS.find((x) => x.label === label);
      return sum + g.keys.reduce((a, k) => a + contrib[k], 0);
    }, 0);
    const total = Math.round(BASE_POINTS + (r.logit - meanLogit) * POINTS_PER_LOGIT);
    const base = Math.round(BASE_POINTS + recordPoints);
    const hasData = (h.pastRaces || []).length > 0 || Boolean(r.overallRec) || Boolean(h.jockeyAgg);
    const recentForm = (h.pastRaces || []).slice(0, 5).map((p) => ({ result: p.result, league: p.league }));
    const hasJraHistory = (h.pastRaces || []).some((p) => p.league === "JRA");
    return {
      ...h,
      base,
      bonus: total - base,
      total,
      winProb: Math.exp(r.logit - maxLogit) / expSum,
      applied,
      hasData,
      usedPastRaces: (h.pastRaces || []).length > 0,
      recentForm,
      hasJraHistory,
    };
  });

  scored.sort((a, b) => b.total - a.total);
  scored.forEach((h, i) => (h.rank = i + 1));
  return scored;
}

// スコア済みの馬一覧(rank, total, winProb, hasData, appliedを持つ)から印を判定する。
// ◎○▲は予測の上位3頭固定、△は3位との得点差が僅かな馬(最大4頭まで)、
// 穴は「◎○▲△に入らなかった馬のうち、加点理由の合計が最も大きい馬」に付ける。
// 出走馬全員のデータが無い時は、印を一切付けない。
const TRIANGLE_THRESHOLD = 3;
const MAX_TRIANGLE = 4;

function positiveReasons(h) {
  return h.applied.reduce((sum, a) => sum + Math.max(0, a.score), 0);
}

export function computeMarks(scored) {
  const noDifferentiation = scored.every((h) => !h.hasData);
  if (noDifferentiation) return { marksByUmaban: {}, noDifferentiation };

  const byRank = [...scored].sort((a, b) => a.rank - b.rank);
  const marks = {};
  byRank.slice(0, 3).forEach((h, i) => {
    marks[h.umaban] = MARKS[i];
  });

  const third = byRank[2];
  if (third) {
    let count = 0;
    byRank.forEach((h) => {
      if (marks[h.umaban] || count >= MAX_TRIANGLE) return;
      const diff = third.total - h.total;
      if (diff >= 0 && diff <= TRIANGLE_THRESHOLD) {
        marks[h.umaban] = MARKS[3];
        count += 1;
      }
    });
  }

  const anaCandidates = byRank.filter((h) => !marks[h.umaban] && positiveReasons(h) > 0);
  if (anaCandidates.length > 0) {
    const best = Math.max(...anaCandidates.map(positiveReasons));
    anaCandidates.filter((h) => positiveReasons(h) === best).forEach((h) => {
      marks[h.umaban] = MARKS[4];
    });
  }

  return { marksByUmaban: marks, noDifferentiation: false };
}
