import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { fetchRaces } from "./lib/api";
import { formatDate, shiftDate, todayStr } from "./lib/date";
import { PAPER, PAPER_CARD, INK, MUTED, MINT } from "./lib/colors";
import Masthead from "./components/Masthead";
import RaceCard from "./components/RaceCard";

export default function App() {
  const [today] = useState(() => todayStr());
  const [date, setDate] = useState(() => todayStr());
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [venue, setVenue] = useState(null);
  const [raceId, setRaceId] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchRaces(date)
      .then((r) => {
        setRaces(r);
        setVenue(r[0]?.venue || null);
        setRaceId(r[0]?.id || null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [date]);

  const venues = useMemo(() => [...new Set(races.map((r) => r.venue))], [races]);
  const racesAtVenue = useMemo(() => races.filter((r) => r.venue === venue), [races, venue]);
  const selectedRace = useMemo(() => races.find((r) => r.id === raceId), [races, raceId]);

  return (
    <div className="min-h-screen relative" style={{ background: PAPER, fontFamily: "'Zen Old Mincho','Shippori Mincho',serif" }}>
      <Masthead subtitle={`${formatDate(date)}${venues.length ? `・${venues.length}場開催` : ""}`} />

      <div className="max-w-md mx-auto relative pb-24" style={{ background: PAPER, minHeight: "100vh" }}>
        <div className="px-4 pt-4">
          {loading && (
            <p className="text-xs py-6 text-center" style={{ color: MUTED }}>
              読み込み中...
            </p>
          )}
          {error && (
            <p className="text-xs py-6 text-center" style={{ color: MUTED }}>
              エラー: {error}
            </p>
          )}
          {!loading && !error && races.length === 0 && (
            <p className="text-xs py-6 text-center" style={{ color: MUTED }}>
              この日の開催情報はありません。
            </p>
          )}

          {venues.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mb-2">
              {venues.map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setVenue(v);
                    setRaceId(races.find((r) => r.venue === v)?.id);
                  }}
                  className="px-3 py-1.5 text-xs font-bold"
                  style={{
                    background: v === venue ? INK : "transparent",
                    color: v === venue ? PAPER_CARD : INK,
                    border: `1px solid ${INK}`,
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          {racesAtVenue.length > 0 && (
            <div className="flex gap-1 flex-wrap mb-3">
              {racesAtVenue.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setRaceId(r.id)}
                  className="px-2.5 py-1 text-xs font-semibold"
                  style={{
                    background: r.id === raceId ? PAPER_CARD : "transparent",
                    color: INK,
                    border: `1px solid ${r.id === raceId ? INK : MUTED}`,
                  }}
                >
                  {r.raceNumber}R
                </button>
              ))}
            </div>
          )}

          <RaceCard race={selectedRace} />
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20" style={{ background: MINT, borderTop: `2px solid ${INK}` }}>
        <div className="max-w-md mx-auto flex items-center">
          <button onClick={() => setDate(shiftDate(date, -1))} className="flex-1 flex flex-col items-center gap-0.5 py-2">
            <ChevronLeft size={18} color={INK} style={{ opacity: 0.75 }} />
            <span className="text-[0.625rem] font-semibold" style={{ color: INK, opacity: 0.75, fontFamily: "'Shippori Mincho', serif" }}>
              前日
            </span>
          </button>

          <div className="flex flex-col items-center gap-0.5 py-2 px-2">
            <span className="text-sm font-black" style={{ color: INK, fontFamily: "'Shippori Mincho', serif" }}>
              {formatDate(date)}
            </span>
            {date !== today && (
              <button onClick={() => setDate(today)} className="flex items-center gap-0.5 text-[0.625rem] font-semibold" style={{ color: INK, opacity: 0.75 }}>
                <RotateCcw size={10} />
                今日
              </button>
            )}
          </div>

          <button onClick={() => setDate(shiftDate(date, 1))} className="flex-1 flex flex-col items-center gap-0.5 py-2">
            <ChevronRight size={18} color={INK} style={{ opacity: 0.75 }} />
            <span className="text-[0.625rem] font-semibold" style={{ color: INK, opacity: 0.75, fontFamily: "'Shippori Mincho', serif" }}>
              翌日
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
