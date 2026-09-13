import { useState } from "react";
import { getMark, cycleMark } from "../lib/marks";
import { formatPostTime } from "../lib/date";
import { PAPER_CARD, INK, RED, MUTED, LINE } from "../lib/colors";
import WakuBadge from "./WakuBadge";

function MarkButton({ raceId, umaban }) {
  const [mark, setMark] = useState(() => getMark(raceId, umaban));
  return (
    <button
      onClick={() => setMark(cycleMark(raceId, umaban))}
      title="クリックで印を切り替え"
      className="w-7 h-6 text-sm font-black shrink-0"
      style={{ color: mark ? RED : MUTED, background: PAPER_CARD, border: `1px solid ${mark ? RED : MUTED}`, fontFamily: "'Shippori Mincho', serif" }}
    >
      {mark || "―"}
    </button>
  );
}

export default function RaceCard({ race }) {
  if (!race) return null;
  const surfaceLabel = race.surface && race.distance ? `${race.surface}${race.distance}m${race.turn ? `(${race.turn})` : ""}` : "";

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
              return (
                <tr key={h.umaban} style={{ background: isWin ? "#F3E4C8" : PAPER_CARD, borderBottom: i < race.horses.length - 1 ? `1px solid ${LINE}` : "none" }}>
                  <td className="px-2 py-1.5 text-center">
                    <MarkButton raceId={race.id} umaban={h.umaban} />
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
