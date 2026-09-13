import { useState } from "react";
import { getMark, cycleMark } from "../lib/marks";
import { formatPostTime } from "../lib/date";

const WAKU_COLORS = {
  1: "#ffffff",
  2: "#000000",
  3: "#e02020",
  4: "#1a5fd0",
  5: "#f2c200",
  6: "#1a9e46",
  7: "#f07a1a",
  8: "#e85fb0",
};

function WakuBadge({ waku }) {
  const bg = WAKU_COLORS[waku] || "#999";
  const dark = waku === 1 || waku === 5;
  return (
    <span className="waku" style={{ background: bg, color: dark ? "#000" : "#fff", border: waku === 1 ? "1px solid #999" : "none" }}>
      {waku}
    </span>
  );
}

function MarkButton({ raceId, umaban }) {
  const [mark, setMark] = useState(() => getMark(raceId, umaban));
  return (
    <button className="mark-btn" onClick={() => setMark(cycleMark(raceId, umaban))} title="クリックで印を切り替え">
      {mark || "―"}
    </button>
  );
}

export default function RaceCard({ race }) {
  if (!race) return null;
  const surfaceLabel = race.surface && race.distance ? `${race.surface}${race.distance}m${race.turn ? `(${race.turn})` : ""}` : "";

  return (
    <div className="race-card">
      <div className="race-card-header">
        <div className="race-card-header-top">
          <span className="race-no">{race.raceNumber}R</span>
          <span className="race-name">{race.name || race.kind}</span>
          <span className="post-time">{formatPostTime(race.postTime)}発走</span>
        </div>
        <div className="race-card-header-sub">
          <span>{surfaceLabel}</span>
          {race.entryCondition && <span>{race.entryCondition}</span>}
          {race.weather && <span>天候:{race.weather}</span>}
          {race.condition && <span>馬場:{race.condition}</span>}
          <span>{race.headCount}頭</span>
        </div>
      </div>

      <div className="table-scroll">
        <table className="horse-table">
          <thead>
            <tr>
              <th>印</th>
              <th>枠</th>
              <th>馬番</th>
              <th className="col-name">馬名</th>
              <th>性齢</th>
              <th>斤量</th>
              <th className="col-name">騎手</th>
              <th className="col-name">調教師</th>
              <th>馬体重</th>
              <th>全成績</th>
              <th>当場成績</th>
              <th>当距離</th>
              <th>単勝</th>
              <th>人気</th>
              {race.isFinished && (
                <>
                  <th>着順</th>
                  <th>タイム</th>
                  <th>上3F</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {race.horses.map((h) => (
              <tr key={h.umaban} className={h.result === "1" || h.result === 1 ? "row-win" : ""}>
                <td>
                  <MarkButton key={`${race.id}_${h.umaban}`} raceId={race.id} umaban={h.umaban} />
                </td>
                <td>
                  <WakuBadge waku={h.waku} />
                </td>
                <td className="num">{h.umaban}</td>
                <td className="col-name horse-name">{h.name}</td>
                <td>
                  {h.sex}
                  {h.age}
                </td>
                <td>{h.weight}</td>
                <td className="col-name">{h.jockey}</td>
                <td className="col-name">{h.trainer}</td>
                <td>
                  {h.bodyWeight || "―"}
                  {h.bodyWeightDiff ? `(${h.bodyWeightDiff})` : ""}
                </td>
                <td>{h.overallStats || "―"}</td>
                <td>{h.trackStats || "―"}</td>
                <td>{h.distanceStats || "―"}</td>
                <td>{h.odds || "―"}</td>
                <td>{h.ninki || "―"}</td>
                {race.isFinished && (
                  <>
                    <td className="num">{h.result || "―"}</td>
                    <td>{h.result ? h.time || "―" : "―"}</td>
                    <td>{h.result ? h.last3f || "―" : "―"}</td>
                  </>
                )}
              </tr>
            ))}
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
    <div className="payback">
      {rows.map(([label, combo, yen]) =>
        yen ? (
          <span key={label} className="payback-item">
            <b>{label}</b> {combo} <em>{Number(yen).toLocaleString()}円</em>
          </span>
        ) : null
      )}
    </div>
  );
}
