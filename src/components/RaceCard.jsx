import { useMemo } from "react";
import { formatPostTime, formatRaceTime } from "../lib/date";
import { PAPER_CARD, INK, RED, MUTED, LINE, MARKS } from "../lib/colors";
import { scoreRace, computeMarks } from "../lib/scoring";
import GradeChip from "./GradeChip";
import WakuBadge from "./WakuBadge";

export default function RaceCard({ race }) {
  const scored = useMemo(() => (race ? scoreRace(race) : []), [race]);
  const { marksByUmaban, noDifferentiation } = useMemo(() => computeMarks(scored), [scored]);

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
      <h1 className="text-xl font-bold mb-1" style={{ color: INK, fontFamily: "'Shippori Mincho', serif" }}>
        {race.name || race.kind}
      </h1>
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
                    {h.hasData ? `基礎${h.base}${h.usedPastRaces ? "(近走)" : "(通算)"}` : "基礎データなし"}
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
