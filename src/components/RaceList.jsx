import { useMemo } from "react";
import { formatPostTime } from "../lib/date";
import { PAPER_CARD, INK, RED, MUTED } from "../lib/colors";
import { scoreRace, computeMarks } from "../lib/scoring";
import GradeChip from "./GradeChip";

// 印(◎○▲△穴)をまとめてBOXで買ったと仮定した時の的中判定と、◎の単勝的中判定。
// RaceCard内の同ロジックと揃えている(不的中は表示しないためnullを返す)。
function raceBadges(race) {
  const scored = scoreRace(race);
  const { marksByUmaban, noDifferentiation } = computeMarks(scored);

  let boxHit = null;
  if (!noDifferentiation) {
    const top3 = scored.filter((h) => h.result && Number(h.result) <= 3);
    if (top3.length >= 3) {
      const hitCount = top3.filter((h) => Boolean(marksByUmaban[h.umaban])).length;
      if (hitCount === 3) boxHit = "trifecta";
      else if (hitCount === 2) boxHit = "wide";
    }
  }

  const honshi = scored.find((h) => marksByUmaban[h.umaban] === "◎");
  const tanshoHit = Boolean(honshi && honshi.result && Number(honshi.result) === 1);

  const top3Horses = scored
    .filter((h) => h.result && Number(h.result) <= 3)
    .sort((a, b) => Number(a.result) - Number(b.result));

  return { boxHit, tanshoHit, top3Horses };
}

export default function RaceList({ races, onSelect }) {
  const items = useMemo(() => races.map((race) => ({ race, ...raceBadges(race) })), [races]);

  return (
    <div className="space-y-3">
      {items.map(({ race, boxHit, tanshoHit, top3Horses }) => (
        <button
          key={race.id}
          onClick={() => onSelect(race)}
          className="w-full text-left p-4 active:opacity-70 transition-opacity"
          style={{ background: PAPER_CARD, border: `1px solid ${INK}` }}
        >
          <div className="flex items-center gap-2 mb-1">
            <GradeChip grade={race.kind} />
            <span className="text-xs" style={{ color: MUTED }}>
              {formatPostTime(race.postTime)}発走
            </span>
          </div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h2 className="text-lg font-bold" style={{ color: INK, fontFamily: "'Shippori Mincho', serif" }}>
              {race.name || race.kind}
            </h2>
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
          <p className="text-xs" style={{ color: MUTED }}>
            {race.venue}
            {race.raceNumber}R
          </p>
          {top3Horses.length > 0 && (
            <p className="text-xs mt-1.5 font-semibold" style={{ color: INK }}>
              {top3Horses.map((h) => `${h.result}着 ${h.umaban} ${h.name}`).join(" / ")}
            </p>
          )}
        </button>
      ))}
    </div>
  );
}
