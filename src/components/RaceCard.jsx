import { useMemo } from "react";
import { formatPostTime } from "../lib/date";
import { PAPER_CARD, INK, RED, MUTED, LINE, MARKS } from "../lib/colors";
import { scoreRace, computeMarks } from "../lib/scoring";
import WakuBadge from "./WakuBadge";

export default function RaceCard({ race }) {
  const scored = useMemo(() => (race ? scoreRace(race) : []), [race]);
  const { marksByUmaban, noDifferentiation } = useMemo(() => computeMarks(scored), [scored]);

  if (!race) return null;
  const surfaceLabel = race.surface && race.distance ? `${race.surface}${race.distance}m${race.turn ? `(${race.turn})` : ""}` : "";
  const scoreByUmaban = Object.fromEntries(scored.map((h) => [h.umaban, h]));

  return (
    <div style={{ border: `1.5px solid ${INK}`, background: PAPER_CARD }}>
      <div className="p-3" style={{ background: INK }}>
        <div className="flex items-baseline gap-2" style={{ fontFamily: "'Shippori Mincho', serif" }}>
          <span className="text-xl font-black" style={{ color: PAPER_CARD }}>
            {race.raceNumber}R
          </span>
          <span className="flex-1 text-[0.9375rem] font-bold truncate" style={{ color: PAPER_CARD }}>
            {race.name || race.kind}
          </span>
          <span className="text-xs" style={{ color: PAPER_CARD, opacity: 0.85 }}>
            {formatPostTime(race.postTime)}発走
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[0.625rem]" style={{ color: PAPER_CARD, opacity: 0.85 }}>
          <span>{surfaceLabel}</span>
          {race.entryCondition && <span>{race.entryCondition}</span>}
          {race.weather && <span>天候:{race.weather}</span>}
          {race.condition && <span>馬場:{race.condition}</span>}
          <span>{race.headCount}頭</span>
        </div>
      </div>

      {!noDifferentiation && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2" style={{ background: "#F3E4C8", borderBottom: `1.5px solid ${INK}` }}>
          {MARKS.flatMap((m) => scored.filter((h) => marksByUmaban[h.umaban] === m)).map((h) => (
            <span key={h.umaban} className="font-black" style={{ fontSize: "1rem", fontFamily: "'Shippori Mincho', serif", color: marksByUmaban[h.umaban] === MARKS[0] ? RED : INK }}>
              {marksByUmaban[h.umaban]}
              {h.umaban} {h.name}
            </span>
          ))}
        </div>
      )}
      {noDifferentiation && (
        <p className="px-3 py-1.5 text-[0.625rem]" style={{ color: MUTED, borderBottom: `1px solid ${LINE}` }}>
          判断材料(通算成績)が乏しいため印は付けていません
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs whitespace-nowrap" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F3E4C8" }}>
              {["印", "枠", "馬番", "馬名", "性齢", "斤量", "騎手", "調教師", "馬体重", "全成績", "当場成績", "当距離", "単勝", "人気"].map((h) => (
                <th key={h} className="px-2 py-1.5 font-bold" style={{ color: INK, borderBottom: `1.5px solid ${INK}` }}>
                  {h}
                </th>
              ))}
              {race.isFinished &&
                ["着順", "タイム", "上3F"].map((h) => (
                  <th key={h} className="px-2 py-1.5 font-bold" style={{ color: INK, borderBottom: `1.5px solid ${INK}` }}>
                    {h}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {race.horses.map((h, i) => {
              const isWin = h.result === "1" || h.result === 1;
              const mark = marksByUmaban[h.umaban];
              const applied = scoreByUmaban[h.umaban]?.applied ?? [];
              const rationale = applied.length ? applied.map((a) => `${a.label}:${a.score > 0 ? "+" : ""}${a.score}`).join(" / ") : "補正材料なし";
              return (
                <tr key={h.umaban} style={{ background: isWin ? "#F3E4C8" : PAPER_CARD, borderBottom: i < race.horses.length - 1 ? `1px solid ${LINE}` : "none" }}>
                  <td className="px-2 py-1.5 text-center font-black" style={{ color: mark === MARKS[0] ? RED : INK, fontFamily: "'Shippori Mincho', serif" }} title={rationale}>
                    {mark || "―"}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <WakuBadge num={h.waku} waku={h.waku} />
                  </td>
                  <td className="px-2 py-1.5 text-center font-bold" style={{ color: INK }}>
                    {h.umaban}
                  </td>
                  <td className="px-2 py-1.5 text-left font-bold" style={{ color: INK, fontFamily: "'Shippori Mincho', serif" }}>
                    {h.name}
                  </td>
                  <td className="px-2 py-1.5 text-center" style={{ color: INK }}>
                    {h.sex}
                    {h.age}
                  </td>
                  <td className="px-2 py-1.5 text-center" style={{ color: INK }}>
                    {h.weight}
                  </td>
                  <td className="px-2 py-1.5 text-left" style={{ color: INK }}>
                    {h.jockey}
                  </td>
                  <td className="px-2 py-1.5 text-left" style={{ color: INK }}>
                    {h.trainer}
                  </td>
                  <td className="px-2 py-1.5 text-center" style={{ color: MUTED }}>
                    {h.bodyWeight || "―"}
                    {h.bodyWeightDiff ? `(${h.bodyWeightDiff})` : ""}
                  </td>
                  <td className="px-2 py-1.5 text-center" style={{ color: MUTED }}>
                    {h.overallStats || "―"}
                  </td>
                  <td className="px-2 py-1.5 text-center" style={{ color: MUTED }}>
                    {h.trackStats || "―"}
                  </td>
                  <td className="px-2 py-1.5 text-center" style={{ color: MUTED }}>
                    {h.distanceStats || "―"}
                  </td>
                  <td className="px-2 py-1.5 text-center font-bold" style={{ color: INK }}>
                    {h.odds || "―"}
                  </td>
                  <td className="px-2 py-1.5 text-center" style={{ color: MUTED }}>
                    {h.ninki || "―"}
                  </td>
                  {race.isFinished && (
                    <>
                      <td
                        className="px-2 py-1.5 text-center font-black"
                        style={{ color: h.result === "1" ? RED : h.result ? INK : MUTED, fontFamily: "'Shippori Mincho', serif" }}
                      >
                        {h.result || "―"}
                      </td>
                      <td className="px-2 py-1.5 text-center" style={{ color: MUTED }}>
                        {h.result ? h.time || "―" : "―"}
                      </td>
                      <td className="px-2 py-1.5 text-center" style={{ color: MUTED }}>
                        {h.result ? h.last3f || "―" : "―"}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {race.payback && <PaybackPanel payback={race.payback} />}
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
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 text-xs" style={{ borderTop: `1.5px solid ${INK}` }}>
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
