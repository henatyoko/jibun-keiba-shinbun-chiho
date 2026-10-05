// 地方競馬の日次/月次CSVには馬の一意なIDが無いため、Edge Function側
// (supabase/functions/nar-races)が「馬名+生年月日」をキーに対象月+前月の
// 月次ファイルを突き合わせて、各馬の直近走(pastRaces、最大5走・新しい順)を
// 拾い集めて渡してくる。ここではその直近走を使い、無ければ通算成績
// (全成績・当場成績・うち当距離成績。X-X-X-X=1着-2着-3着-着外)にフォールバックする。
//
// 過去には「市場の人気・オッズは意図的に見ない、独自の評価だけで勝負する」方針だったが、
// 実測(◎が市場の1番人気と違う馬を指した時の勝率9.7%、1番人気をそのまま買った時の
// 勝率44.8%)で、独自ロジック単体では市場の精度に遠く及ばないことが分かった。市場の
// 人気には、パドックの気配・調教師のコメント・当日の細かい変化などCSVに出てこない
// 情報も織り込まれていると考えられる。そのため人気を「土台」に据え、そこに騎手コンビ・
// 血統・クラス変動・当場当距離適性・過去走の内容などの独自材料を補正として上乗せする
// 方式に変更した(人気そのものをなぞるだけにならないよう、補正の上限は小さめに抑えている)。

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
// 実測では人気1位グループと人気7位以下グループの平均baseスコア差がわずか4点程度しか
// 出ておらず(倍率30のまま)、その差より各種補正(騎手コンビ・当場当距離等、単体で
// ±3〜4点)の方が大きく効いてしまい、市場が正しく評価している実力差を補正が
// 簡単に覆してしまっていた。実力差がスコアにもっとしっかり反映されるよう倍率を上げる。
const OVERALL_SENSITIVITY = 120;
export function baseScoreFromOverall(overallStr) {
  const rec = parseRecord(overallStr);
  if (!rec || rec.starts === 0) return { score: 70, rec: null };
  const rate = top3Rate(rec);
  const shrink = Math.min(rec.starts / 8, 1);
  const raw = (rate - 0.3) * OVERALL_SENSITIVITY;
  return { score: Math.round(70 + raw * shrink), rec };
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

// その1走が「人気(市場の期待値)に対してどうだったか」で加減点する。単勝オッズが
// 取れている場合(2026年3月以降のレース。nar_race_history.tansho_odds)はオッズの
// 対数を使い、勝った場合はオッズが高いほど(人気薄の勝利ほど)高評価、負けた場合は
// オッズが低かった(本命だった)のに着外だったケースほど大きく減点する。オッズが
// 無い古いレースは、人気順位を代用値にした簡易版にフォールバックする。
function oddsSurprisePoint(finish, odds) {
  const f = Number(finish);
  const o = Number(odds);
  if (!Number.isFinite(f) || f <= 0 || !Number.isFinite(o) || o <= 0) return null;
  const expectedRank = Math.max(1, Math.log10(o) * 4 + 1);
  return Math.max(-4, Math.min(4, (expectedRank - f) * 0.6));
}

function ninkiSurprisePoint(finish, ninki) {
  const f = Number(finish);
  const n = Number(ninki);
  if (!Number.isFinite(f) || f <= 0 || !Number.isFinite(n) || n <= 0) return 0;
  return Math.max(-3, Math.min(3, (n - f) * 0.5));
}

function surprisePoint(r) {
  const odds = oddsSurprisePoint(r.result, r.odds);
  return odds != null ? odds : ninkiSurprisePoint(r.result, r.ninki);
}

function pointForPastRun(r) {
  const money = r.league === "JRA" ? moneyPointJra(r.money) : moneyPointNar(r.money);
  const base = money != null ? money : financePointFromFinish(Number(r.result));
  return base + surprisePoint(r);
}

// 市場の人気順位を基礎点に変換する。人気1位を100点とし、順位が下がるほど対数的に
// 減衰させる(実際の勝率も人気順位に対してほぼ対数的に減っていくため)。K=15は
// 実測データ(直近60日の人気グループ別勝率)に大きく反しない範囲で選んだ初期値。
const NINKI_BASE_DECAY = 15;
export function baseScoreFromNinki(ninki) {
  const n = Number(ninki);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(100 - Math.log2(n) * NINKI_BASE_DECAY);
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
const PAST_RACE_SENSITIVITY = 8;

// 直近走(最大5走・新しい順)から基礎点を算出する。(1)獲得賞金からその1走の価値を
// 点数化(レースの格・着順の良さを両方反映)、(2)レース日が近いほど重みを付ける
// (半減期60日)、(3)上がり3Fが直近ほど速くなっていれば上向きとして加点、の3軸。
// pastRacesが無ければnullを返す(呼び出し側はbaseScoreFromOverallにフォールバックする)。
export function baseScoreFromPastRaces(pastRaces, currentDateStr) {
  if (!pastRaces || pastRaces.length === 0) return null;
  const currentMs = dateStrToMs(currentDateStr);
  let weightedSum = 0;
  let weightTotal = 0;
  let sampleCount = 0;

  pastRaces.slice(0, 5).forEach((r) => {
    const finish = Number(r.result);
    if (!Number.isFinite(finish) || finish <= 0) return;
    const point = pointForPastRun(r);
    const pastMs = dateStrToMs(r.date);
    const daysAgo = pastMs != null && currentMs != null ? Math.max(0, (currentMs - pastMs) / 86400000) : RECENCY_HALF_LIFE_DAYS * 1.5;
    const weight = Math.pow(0.5, daysAgo / RECENCY_HALF_LIFE_DAYS);
    weightedSum += point * weight;
    weightTotal += weight;
    sampleCount += 1;
  });

  if (weightTotal === 0) return null;
  const shrink = Math.min(sampleCount / 5, 1);
  const avg = (weightedSum / weightTotal) * shrink;

  let agariBonus = 0;
  const agariTimes = pastRaces
    .slice(0, 5)
    .map((r) => Number(r.last3f))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (agariTimes.length >= 2) {
    const [latest, ...rest] = agariTimes;
    const restAvg = rest.reduce((sum, v) => sum + v, 0) / rest.length;
    const improve = restAvg - latest; // 正なら直近の方が上がりが速い(良化)
    agariBonus = Math.max(-2, Math.min(2, improve * 2));
  }

  // 人気1位グループと7位以下グループの平均base差が実測4点程度しかなく、単体で
  // ±3〜4点動く各種補正に実力差が簡単に覆されていたため、感度を上げる
  // (上がり3Fの改善ボーナスはサンプルが薄い(最大2走比較)ので、増幅の対象外にして
  // そのまま最終点に加える)。
  return Math.round(70 + avg * PAST_RACE_SENSITIVITY + agariBonus);
}

// 基礎点を人気(市場)に切り替えたことに伴い、旧来の「過去走から出した絶対点」は
// そのままだと市場の判断と二重に競合してしまう。70を中心とした差分に変換し、
// 他の補正と同じ規模(上限±6)に抑えた「独自材料の1つ」として扱う。
const PAST_PERFORMANCE_CAP = 6;
export function pastPerformanceAdjustment(pastRaces, overallStr, currentDateStr) {
  const pastBase = baseScoreFromPastRaces(pastRaces, currentDateStr);
  const overall = baseScoreFromOverall(overallStr);
  const raw = pastBase != null ? pastBase : overall.score;
  const score = Math.max(-PAST_PERFORMANCE_CAP, Math.min(PAST_PERFORMANCE_CAP, Math.round(raw - 70)));
  if (score === 0) return null;
  return { label: "過去走評価", score };
}

// 当場/当距離の成績が、その馬の通算成績(基準)より良い/悪いかで補正する。
function fitAdjustment(label, statStr, overallRec, weight) {
  const rec = parseRecord(statStr);
  // 2〜3走だけで好走率100%/0%のような極端な値になりやすく、直近の悪い着順を
  // 覆すほどの大きい補正が付いてしまっていた(2走2連対で+9点等)。最低3走に上げ、
  // 縮小率の分母もbaseScoreFromOverallと同じ8に広げて、少ない標本の影響を弱める。
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

// 今回のレースのクラスが、直近走(平均)よりも格上/格下かで補正する。格下げ(通用度の
// 高いクラスへ移った)なら加点、格上げなら減点。クラス表記が今回・過去走のどちらかで
// 読み取れない場合は判定しない。
export function classChangeAdjustment(currentClassRank, pastRaces) {
  if (currentClassRank == null) return null;
  const pastRanks = (pastRaces || [])
    .filter((r) => r.league !== "JRA") // JRAはクラス体系が別物なので比較対象に含めない
    .map((r) => parseClassRank(r.raceName))
    .filter((v) => v != null);
  if (pastRanks.length === 0) return null;

  const avgPastRank = pastRanks.reduce((a, b) => a + b, 0) / pastRanks.length;
  const diff = currentClassRank - avgPastRank; // 正なら今回の方が格下(数値が大きい=格下)
  const score = Math.max(-3, Math.min(3, Math.round(diff * 1.5)));
  if (score === 0) return null;
  return { label: diff > 0 ? "クラス格下げ" : "クラス格上げ", score };
}

// JRA(中央)で実際に出走した経験がある馬(pastRacesにleague:"JRA"が混ざっている馬。
// 調教師の所属ではなく馬自身の実戦経験)は、たとえ未勝利でもJRA全体のレベルの高さ
// から地方限定の馬より地力が高いと考えられるため、直近走の重み付けとは別軸で
// 小さく加点する。
export function jraExperienceAdjustment(pastRaces) {
  const hasJra = (pastRaces || []).some((r) => r.league === "JRA");
  if (!hasJra) return null;
  return { label: "JRA実戦経験あり", score: 2 };
}

// レース1つ分の出走馬全頭を採点し、合計点(total)の高い順に並べて返す。
export function scoreRace(race) {
  const isHandicap = /ハンデ/.test(race.entryCondition || "");
  const weights = race.horses.map((h) => parseWeight(h.weight)).filter((w) => w != null);
  const fieldAvgWeight = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null;
  const currentClassRank = parseClassRank(race.name);

  const scored = race.horses.map((h) => {
    const overall = baseScoreFromOverall(h.overallStats);
    const pastBase = baseScoreFromPastRaces(h.pastRaces, race.date);
    const usedPastRaces = pastBase != null;
    const ninkiBase = baseScoreFromNinki(h.ninki);
    // 市場(人気)を土台にする。人気が取れない場合(オッズ未確定のごく一部のケース)は
    // 従来通り過去走/通算成績ベースの点にフォールバックする。
    const base = ninkiBase != null ? ninkiBase : usedPastRaces ? pastBase : overall.score;
    const applied = [];

    const pastPerformance = pastPerformanceAdjustment(h.pastRaces, h.overallStats, race.date);
    if (pastPerformance) applied.push(pastPerformance);
    const track = trackFitAdjustment(h.trackStats, overall.rec);
    if (track) applied.push(track);
    const distance = distanceFitAdjustment(h.distanceStats, overall.rec);
    if (distance) applied.push(distance);
    const jockeyFit = jockeyFitAdjustment(h.jockeyStats, overall.rec);
    if (jockeyFit) applied.push(jockeyFit);
    const pedigree = pedigreeFitAdjustment(h.sireStats, h.damsireStats, overall.rec?.starts ?? 0);
    if (pedigree) applied.push(pedigree);
    const bodyWeight = bodyWeightAdjustment(h.bodyWeightDiff);
    if (bodyWeight) applied.push(bodyWeight);
    const handicap = handicapWeightAdjustment(isHandicap, parseWeight(h.weight), fieldAvgWeight);
    if (handicap) applied.push(handicap);
    const classChange = classChangeAdjustment(currentClassRank, h.pastRaces);
    if (classChange) applied.push(classChange);
    const jraExperience = jraExperienceAdjustment(h.pastRaces);
    if (jraExperience) applied.push(jraExperience);

    const bonus = applied.reduce((sum, a) => sum + a.score, 0);
    const recentForm = (h.pastRaces || []).slice(0, 5).map((r) => ({ result: r.result, league: r.league }));
    const hasJraHistory = (h.pastRaces || []).some((r) => r.league === "JRA");
    const hasData = ninkiBase != null || usedPastRaces || Boolean(overall.rec);
    return { ...h, base, bonus, total: base + bonus, applied, hasData, usedPastRaces, recentForm, hasJraHistory };
  });

  scored.sort((a, b) => b.total - a.total);
  scored.forEach((h, i) => (h.rank = i + 1));
  return scored;
}

// スコア済みの馬一覧(rank, total, hasData, appliedを持つ)から印を判定する。
// ◎○▲はスコア上位固定、△は3位との得点差が僅かな馬(最大4頭まで)、
// 穴は「◎○▲△に入らなかった馬のうち、独自材料でプラスが付いている馬」に付ける。
// 出走馬全員が無印(初出走かつ補正材料も無し)の時は、印を一切付けない。
const TRIANGLE_THRESHOLD = 3;
const MAX_TRIANGLE = 4;
// 穴の候補に人気の制限は設けない。90日分(3,907レース)の検証で、人気が下位40%より
// 後ろに限定した場合(複勝率19.4%・複勝回収率70.9%)より、制限なしの方が
// 複勝率22.5%・複勝回収率74.4%と良く、直近30日と前半60日の両方で同じ向きだった。

function ownBonus(h) {
  return h.applied.reduce((sum, a) => sum + a.score, 0);
}

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

  const anaCandidates = byRank.filter((h) => {
    if (marks[h.umaban]) return false;
    return ownBonus(h) > 0;
  });
  if (anaCandidates.length > 0) {
    const bestBonus = Math.max(...anaCandidates.map(ownBonus));
    anaCandidates.filter((h) => ownBonus(h) === bestBonus).forEach((h) => {
      marks[h.umaban] = MARKS[4];
    });
  }

  return { marksByUmaban: marks, noDifferentiation: false };
}
