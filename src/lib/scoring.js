// 地方競馬の日次/月次CSVには馬の一意なIDが無いため、Edge Function側
// (supabase/functions/nar-races)が「馬名+生年月日」をキーに対象月+前月の
// 月次ファイルを突き合わせて、各馬の直近走(pastRaces、最大5走・新しい順)を
// 拾い集めて渡してくる。ここではその直近走を使い、無ければ通算成績
// (全成績・当場成績・うち当距離成績。X-X-X-X=1着-2着-3着-着外)にフォールバックする。
// 市場の単勝オッズ・人気は意図的に見ない(独自の評価をするのがこのアプリの狙いのため)。

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

// 通算成績(全成績)から基礎点を出す。基準は70。出走数が少ないほど70寄りに縮小する
// (デビュー戦・1走だけの馬が極端な点にならないようにするため)。
// pastRacesが無い馬(過去走が今月+前月の月次ファイルに見つからなかった馬)向けの
// フォールバック用。
export function baseScoreFromOverall(overallStr) {
  const rec = parseRecord(overallStr);
  if (!rec || rec.starts === 0) return { score: 70, rec: null };
  const rate = top3Rate(rec);
  const shrink = Math.min(rec.starts / 8, 1);
  const raw = (rate - 0.3) * 30;
  return { score: Math.round(70 + raw * shrink), rec };
}

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

// 過去走の重みは「直近何走目か」ではなく「レース日からの実日数」で決める(半減期60日)。
// 間隔が開くほど自然に過去走の重みが下がるため、休養明けの文脈も反映できる。
const RECENCY_HALF_LIFE_DAYS = 60;

// 直近走(最大5走・新しい順)から基礎点を算出する。(1)着順を点数化、
// (2)レース日が近いほど重みを付ける(半減期60日)、(3)上がり3Fが直近ほど
// 速くなっていれば上向きとして加点、の3軸。pastRacesが無ければnullを返す
// (呼び出し側はbaseScoreFromOverallにフォールバックする)。
export function baseScoreFromPastRaces(pastRaces, currentDateStr) {
  if (!pastRaces || pastRaces.length === 0) return null;
  const currentMs = dateStrToMs(currentDateStr);
  let weightedSum = 0;
  let weightTotal = 0;
  let sampleCount = 0;

  pastRaces.slice(0, 5).forEach((r) => {
    const finish = Number(r.result);
    if (!Number.isFinite(finish) || finish <= 0) return;
    const point = financePointFromFinish(finish);
    const pastMs = dateStrToMs(r.date);
    const daysAgo = pastMs != null && currentMs != null ? Math.max(0, (currentMs - pastMs) / 86400000) : RECENCY_HALF_LIFE_DAYS * 1.5;
    const weight = Math.pow(0.5, daysAgo / RECENCY_HALF_LIFE_DAYS);
    weightedSum += point * weight;
    weightTotal += weight;
    sampleCount += 1;
  });

  if (weightTotal === 0) return null;
  const shrink = Math.min(sampleCount / 5, 1);
  let avg = (weightedSum / weightTotal) * shrink;

  const agariTimes = pastRaces
    .slice(0, 5)
    .map((r) => Number(r.last3f))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (agariTimes.length >= 2) {
    const [latest, ...rest] = agariTimes;
    const restAvg = rest.reduce((sum, v) => sum + v, 0) / rest.length;
    const improve = restAvg - latest; // 正なら直近の方が上がりが速い(良化)
    avg += Math.max(-2, Math.min(2, improve * 2));
  }

  return Math.round(70 + avg * 2);
}

// 当場/当距離の成績が、その馬の通算成績(基準)より良い/悪いかで補正する。
function fitAdjustment(label, statStr, overallRec, weight) {
  const rec = parseRecord(statStr);
  if (!rec || rec.starts < 2) return null;
  const rate = top3Rate(rec);
  const baseline = (overallRec ? top3Rate(overallRec) : null) ?? 0.3;
  const shrink = Math.min(rec.starts / 5, 1);
  const score = Math.round((rate - baseline) * 15 * shrink * weight);
  if (score === 0) return null;
  return { label: `${label}${rec.win}-${rec.place}-${rec.show}-${rec.other}`, score };
}

export function trackFitAdjustment(trackStr, overallRec) {
  return fitAdjustment("当場", trackStr, overallRec, 1);
}

export function distanceFitAdjustment(distanceStr, overallRec) {
  return fitAdjustment("当距離", distanceStr, overallRec, 1.2);
}

// 馬体重の大きな増減(±15kg以上)は仕上がりへの不安材料として小さく減点する。
export function bodyWeightAdjustment(diffStr) {
  const diff = Number(diffStr);
  if (!Number.isFinite(diff) || Math.abs(diff) < 15) return null;
  return { label: `馬体重${diff > 0 ? "+" : ""}${diff}`, score: -2 };
}

// ハンデ戦限定。斤量が同レース平均より軽いほど加点、重いほど減点する。
export function handicapWeightAdjustment(isHandicap, weight, fieldAvgWeight) {
  if (!isHandicap || !Number.isFinite(weight) || !Number.isFinite(fieldAvgWeight)) return null;
  const diffKg = fieldAvgWeight - weight;
  const score = Math.max(-3, Math.min(3, Math.round(diffKg * 1.5)));
  if (score === 0) return null;
  return { label: `斤量${weight}kg`, score };
}

// レース1つ分の出走馬全頭を採点し、合計点(total)の高い順に並べて返す。
export function scoreRace(race) {
  const isHandicap = /ハンデ/.test(race.entryCondition || "");
  const weights = race.horses.map((h) => parseWeight(h.weight)).filter((w) => w != null);
  const fieldAvgWeight = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null;

  const scored = race.horses.map((h) => {
    const overall = baseScoreFromOverall(h.overallStats);
    const pastBase = baseScoreFromPastRaces(h.pastRaces, race.date);
    const usedPastRaces = pastBase != null;
    const base = usedPastRaces ? pastBase : overall.score;
    const applied = [];

    const track = trackFitAdjustment(h.trackStats, overall.rec);
    if (track) applied.push(track);
    const distance = distanceFitAdjustment(h.distanceStats, overall.rec);
    if (distance) applied.push(distance);
    const bodyWeight = bodyWeightAdjustment(h.bodyWeightDiff);
    if (bodyWeight) applied.push(bodyWeight);
    const handicap = handicapWeightAdjustment(isHandicap, parseWeight(h.weight), fieldAvgWeight);
    if (handicap) applied.push(handicap);

    const bonus = applied.reduce((sum, a) => sum + a.score, 0);
    const recentForm = (h.pastRaces || []).slice(0, 5).map((r) => r.result);
    return { ...h, base, bonus, total: base + bonus, applied, hasData: usedPastRaces || Boolean(overall.rec), usedPastRaces, recentForm };
  });

  scored.sort((a, b) => b.total - a.total);
  scored.forEach((h, i) => (h.rank = i + 1));
  return scored;
}

// スコア済みの馬一覧(rank, total, hasData, appliedを持つ)から印を判定する。
// ◎○▲はスコア上位固定、△は3位との得点差が僅かな馬(最大4頭まで)、
// 穴は「得点は低いが加点材料がある馬」の中で最高得点の馬に付ける。
// 出走馬全員が無印(初出走かつ補正材料も無し)の時は、印を一切付けない。
const TRIANGLE_THRESHOLD = 3;
const MAX_TRIANGLE = 4;

export function computeMarks(scored) {
  const noDifferentiation = scored.every((h) => !h.hasData && h.applied.length === 0);
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

  const anaCandidates = byRank.filter((h) => !marks[h.umaban] && h.applied.some((a) => a.score > 0));
  if (anaCandidates.length > 0) {
    const bestTotal = Math.max(...anaCandidates.map((h) => h.total));
    anaCandidates.filter((h) => h.total === bestTotal).forEach((h) => {
      marks[h.umaban] = MARKS[4];
    });
  }

  return { marksByUmaban: marks, noDifferentiation: false };
}
