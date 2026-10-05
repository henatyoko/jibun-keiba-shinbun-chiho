import { useLayoutEffect, useMemo } from "react";
import { formatPostTime, formatRaceTime } from "../lib/date";
import { PAPER_CARD, INK, RED, MUTED, LINE, MARKS } from "../lib/colors";
import { scoreRace, computeMarks } from "../lib/scoring";
import GradeChip from "./GradeChip";
import WakuBadge from "./WakuBadge";

const BABA_LABELS = ["良", "稍重", "重", "不良"];

function formatBabaRecord(rec) {
  if (!rec) return "―";
  const starts = rec.win + rec.place + rec.show + rec.other;
  return starts === 0 ? "―" : `${rec.win}-${rec.place}-${rec.show}-${rec.other}`;
}

function hasAnyBabaRecord(babaStats) {
  return BABA_LABELS.some((b) => formatBabaRecord(babaStats?.[b]) !== "―");
}

export default function RaceCard({ race }) {
  const scored = useMemo(() => (race ? scoreRace(race) : []), [race]);
  const { marksByUmaban, noDifferentiation } = useMemo(() => computeMarks(scored), [scored]);
  // 印(◎○▲△穴)をまとめてBOXで買ったと仮定した時の的中判定。
  // 上位3着が全員印の中に入っていれば3連複BOX的中、2頭だけならワイドBOX的中
  // (上位3着のうちどの2頭の組み合わせでもよい)。不的中は表示不要のためnull。
  const boxHit = useMemo(() => {
    if (noDifferentiation) return null;
    const top3 = scored.filter((h) => h.result && Number(h.result) <= 3);
    if (top3.length < 3) return null;
    const hitCount = top3.filter((h) => Boolean(marksByUmaban[h.umaban])).length;
    if (hitCount === 3) return "trifecta";
    if (hitCount === 2) return "wide";
    return null;
  }, [scored, marksByUmaban, noDifferentiation]);
  // ◎の馬が単勝的中(1着)したかどうかの判定。
  const tanshoHit = useMemo(() => {
    const honshi = scored.find((h) => marksByUmaban[h.umaban] === MARKS[0]);
    if (!honshi || !honshi.result) return false;
    return Number(honshi.result) === 1;
  }, [scored, marksByUmaban]);

  // 一覧でスクロールした状態からレースを開いた時、前の位置が一瞬見えないよう
  // 描画前にページ先頭へ戻す(中央版と同様)。
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [race?.id]);

  if (!race) return null;
  const surfaceLabel = race.surface && race.distance ? `${race.surface}${race.distance}m${race.turn ? `(${race.turn})` : ""}` : "";

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <GradeChip grade={race.kind} />
        <span className="text-xs" style={{ color: MUTED }}>
          {formatPostTime(race.postTime)}発走
        </span>
      </div>
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <h1 className="text-xl font-bold" style={{ color: INK, fontFamily: "'Shippori Mincho', serif" }}>
          {race.name || race.kind}
        </h1>
        {tanshoHit && (
          <span
            className="text-[0.625rem] font-bold px-1.5 py-0.5 shrink-0"
            style={{ color: PAPER_CARD, background: RED, border: `1px solid ${RED}` }}
          >
            単勝的中
          </span>
        )}
        {boxHit != null && (
          <span
            className="text-[0.625rem] font-bold px-1.5 py-0.5 shrink-0"
            style={{ color: PAPER_CARD, background: RED, border: `1px solid ${RED}` }}
          >
            {boxHit === "trifecta" ? "3連複BOX的中" : "ワイドBOX的中"}
          </span>
        )}
      </div>
      <p className="text-xs mb-3" style={{ color: MUTED }}>
        {race.venue}{race.raceNumber}R・{surfaceLabel}
        {race.entryCondition ? `・${race.entryCondition}` : ""}
        {race.weather ? `・天候${race.weather}` : ""}
        {race.condition ? `・馬場${race.condition}` : ""}・{race.headCount}頭
      </p>

      {race.payback && <PaybackPanel payback={race.payback} />}

      {!noDifferentiation ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3 px-3 py-2" style={{ background: PAPER_CARD, border: `1.5px solid ${INK}` }}>
          {MARKS.flatMap((m) => scored.filter((h) => marksByUmaban[h.umaban] === m)).map((h) => (
            <span key={h.umaban} className="font-black" style={{ fontSize: "1rem", fontFamily: "'Shippori Mincho', serif", color: marksByUmaban[h.umaban] === MARKS[0] ? RED : INK }}>
              {marksByUmaban[h.umaban]}
              {h.umaban}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs px-2 py-1 mb-3" style={{ color: MUTED, border: `1px dashed ${MUTED}` }}>
          判断材料(通算成績)が乏しいため印は付けていません
        </p>
      )}

      <div style={{ border: `1.5px solid ${INK}` }}>
        {scored.map((h, i) => {
          const mark = marksByUmaban[h.umaban] || "";
          const isTop = mark === MARKS[0];
          return (
            <div
              key={h.umaban}
              className="p-2.5"
              style={{
                background: isTop ? "#F3E4C8" : PAPER_CARD,
                borderBottom: i < scored.length - 1 ? `1px solid ${LINE}` : "none",
              }}
            >
              <div className="flex items-start gap-2 mb-1.5">
                <div className="font-black w-6 text-center shrink-0" style={{ color: isTop ? RED : INK, fontFamily: "'Shippori Mincho', serif", fontSize: "20px" }}>
                  {mark}
                </div>
                <WakuBadge num={h.umaban} waku={h.waku} />
                <div className="flex-1 min-w-0">
                  {h.result && (
                    <div className="font-black text-sm" style={{ color: h.result === "1" ? RED : Number(h.result) <= 3 ? INK : MUTED, fontFamily: "'Shippori Mincho', serif" }}>
                      {h.result}着
                    </div>
                  )}
                  <div className="font-bold text-[0.9375rem] flex items-center gap-1.5" style={{ color: INK, fontFamily: "'Shippori Mincho', serif" }}>
                    {h.name}
                    {h.hasJraHistory && (
                      <span className="text-[0.5625rem] font-semibold px-1 py-0.5" style={{ color: MUTED, border: `1px solid ${MUTED}`, fontFamily: "sans-serif" }}>
                        元中央
                      </span>
                    )}
                  </div>
                  <div className="text-[0.625rem]" style={{ color: MUTED }}>
                    {h.sex}
                    {h.age}歳・{h.jockey}・斤量{h.weight}
                    {h.trainer ? `・${h.trainer}厩舎` : ""}
                  </div>
                  <div className="text-[0.625rem] mt-0.5" style={{ color: MUTED }}>
                    全成績{h.overallStats || "―"}・当場{h.trackStats || "―"}・当距離{h.distanceStats || "―"}
                    {h.bodyWeight ? `・馬体重${h.bodyWeight}kg${h.bodyWeightDiff ? `(${h.bodyWeightDiff})` : ""}` : ""}
                  </div>
                  {hasAnyBabaRecord(h.babaStats) && (
                    <div className="text-[0.625rem] mt-0.5 flex items-center gap-x-2 flex-wrap" style={{ color: MUTED }}>
                      <span>馬場別:</span>
                      {BABA_LABELS.map((b) => {
                        const isToday = race.condition === b;
                        return (
                          <span key={b} className={isToday ? "font-bold" : ""} style={{ color: isToday ? INK : MUTED, textDecoration: isToday ? "underline" : "none" }}>
                            {b}
                            {formatBabaRecord(h.babaStats?.[b])}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {h.recentForm?.length > 0 && (
                    <div className="text-[0.625rem] mt-0.5 flex items-center gap-1" style={{ color: MUTED }}>
                      <span>近{h.recentForm.length}走:</span>
                      <span className="flex gap-1">
                        {h.recentForm.map((r, i) => (
                          <span key={i} className="font-bold" style={{ color: r.result === "1" ? RED : Number(r.result) <= 3 ? INK : MUTED }}>
                            {r.result}
                            {r.league === "JRA" && <sup>中</sup>}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 w-12">
                  <div className="text-xl font-black tabular-nums" style={{ color: isTop ? RED : INK, fontFamily: "'Shippori Mincho', serif" }}>
                    {h.total}
                  </div>
                  <div className="text-[0.5625rem]" style={{ color: MUTED }}>
                    {h.hasData ? `勝率予測${Math.round(h.winProb * 100)}%` : "データなし"}
                  </div>
                </div>
              </div>

              {(h.result || h.odds) && (
                <div className="flex items-start gap-2 mb-1.5">
                  <div className="w-6 shrink-0" aria-hidden="true" />
                  <div style={{ width: 28 }} className="shrink-0" aria-hidden="true" />
                  <div className="text-[0.625rem] font-bold flex-1 min-w-0" style={{ color: h.result === "1" ? RED : h.result ? INK : MUTED }}>
                    {h.result ? (
                      <>
                        タイム{formatRaceTime(h.time) || "―"}
                        {h.last3f ? `(上3F${h.last3f})` : ""}
                      </>
                    ) : (
                      "オッズ:"
                    )}
                    {h.odds && (
                      <span className="font-normal" style={{ color: MUTED }}>
                        {" "}
                        {h.odds}倍{h.ninki ? `(${h.ninki}人気)` : ""}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {(!h.hasData || h.applied.length > 0) && (
                <div className="flex items-start gap-2">
                  <div className="w-6 shrink-0" aria-hidden="true" />
                  <div style={{ width: 28 }} className="shrink-0" aria-hidden="true" />
                  <div className="flex flex-wrap gap-1.5 flex-1">
                    {!h.hasData && (
                      <span className="text-[0.625rem] px-1.5 py-0.5 font-semibold" style={{ border: `1px dashed ${MUTED}`, color: MUTED }}>
                        評価データなし・他の補正のみ反映
                      </span>
                    )}
                    {h.applied.map((a, i) => (
                      <span key={i} className="text-[0.625rem] px-1.5 py-0.5 font-semibold" style={{ border: `1px solid ${a.score > 0 ? INK : RED}`, color: a.score > 0 ? INK : RED }}>
                        {a.label} {a.score > 0 ? "+" : ""}
                        {a.score}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PaybackPanel({ payback }) {
  const rows = [
    ["単勝", payback["単勝組番"], payback["単勝払戻金（円）"]],
    ["複勝", payback["複勝組番1"], payback["複勝払戻金1（円）"]],
    ["馬連", `${payback["馬複組番1"]}-${payback["馬複組番2"]}`, payback["馬複払戻金（円）"]],
    ["馬単", `${payback["馬単組番1"]}→${payback["馬単組番2"]}`, payback["馬単払戻金（円）"]],
    ["3連複", `${payback["３連複組番馬番1"]}-${payback["３連複組番馬番2"]}-${payback["３連複組番馬番3"]}`, payback["３連複払戻金（円）"]],
    ["3連単", `${payback["３連単組番馬番1"]}→${payback["３連単組番馬番2"]}→${payback["３連単組番馬番3"]}`, payback["３連単払戻金（円）"]],
  ];
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 px-3 py-2 text-xs" style={{ background: PAPER_CARD, border: `1.5px solid ${INK}` }}>
      {rows.map(([label, combo, yen]) =>
        yen ? (
          <span key={label} style={{ color: INK }}>
            <b style={{ fontFamily: "'Shippori Mincho', serif" }}>{label}</b> {combo}{" "}
            <em className="not-italic font-bold" style={{ color: RED }}>
              {Number(yen).toLocaleString()}円
            </em>
          </span>
        ) : null
      )}
    </div>
  );
}
