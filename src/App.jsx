import { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useParams, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import { fetchRaces } from "./lib/api";
import { formatDate, shiftDate, todayStr } from "./lib/date";
import { PAPER, PAPER_CARD, INK, MUTED, MINT } from "./lib/colors";
import Masthead from "./components/Masthead";
import RaceCard from "./components/RaceCard";

function LoadingOverlay() {
  return (
    <div className="fixed inset-0 z-[5] flex flex-col items-center justify-center gap-2" style={{ background: "rgba(251, 246, 232, 0.9)" }}>
      <div className="horse-run-track">
        <span>🐎</span>
      </div>
      <p className="text-xs" style={{ color: INK }}>
        レース情報を取得中…
      </p>
    </div>
  );
}

// レース1つ分の画面(/:date/:venue/:raceNumber)。パラメータが省略されていたり
// その日に存在しない値の時は、実際のデータから決まる正しいURLへリダイレクトする
// (常に完全なURLでシェア・ブックマークできるようにするため)。
function MeetingView() {
  const { date: paramDate, venue: paramVenue, raceNumber: paramRaceNumber } = useParams();
  const navigate = useNavigate();
  const today = todayStr();
  const date = paramDate || today;

  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchRaces(date)
      .then(setRaces)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [date]);

  const venues = useMemo(() => [...new Set(races.map((r) => r.venue))], [races]);
  const canonicalVenue = venues.includes(paramVenue) ? paramVenue : venues[0];
  const racesAtVenue = useMemo(() => races.filter((r) => r.venue === canonicalVenue), [races, canonicalVenue]);
  const canonicalRaceNumber = racesAtVenue.some((r) => String(r.raceNumber) === paramRaceNumber)
    ? paramRaceNumber
    : racesAtVenue[0] != null
      ? String(racesAtVenue[0].raceNumber)
      : undefined;
  const selectedRace = racesAtVenue.find((r) => String(r.raceNumber) === canonicalRaceNumber);

  if (!loading && !error && venues.length > 0) {
    if (!paramDate || paramVenue !== canonicalVenue || paramRaceNumber !== canonicalRaceNumber) {
      return <Navigate to={`/${date}/${canonicalVenue}/${canonicalRaceNumber}`} replace />;
    }
  }

  return (
    <div className="min-h-screen relative" style={{ background: PAPER, fontFamily: "'Zen Old Mincho','Shippori Mincho',serif" }}>
      <Masthead subtitle={`${formatDate(date)}${venues.length ? `・${venues.length}場開催` : ""}`} />

      <div className="max-w-md mx-auto relative pb-24" style={{ background: PAPER, minHeight: "100vh" }}>
        <div className="px-4 pt-4">
          {loading && <LoadingOverlay />}
          {!loading && !error && races.length > 0 && (
            <p className="text-xs mb-3" style={{ color: MUTED }}>
              通算成績・直近走ベースの自動採点で表示
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
              {venues.map((v) => {
                const firstRaceNumber = races.find((r) => r.venue === v)?.raceNumber;
                return (
                  <button
                    key={v}
                    onClick={() => navigate(`/${date}/${v}/${firstRaceNumber}`)}
                    className="px-3 py-1.5 text-xs font-bold"
                    style={{
                      background: v === canonicalVenue ? INK : "transparent",
                      color: v === canonicalVenue ? PAPER_CARD : INK,
                      border: `1px solid ${INK}`,
                    }}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          )}

          {racesAtVenue.length > 0 && (
            <div className="flex gap-1 flex-wrap mb-3">
              {racesAtVenue.map((r) => (
                <button
                  key={r.id}
                  onClick={() => navigate(`/${date}/${canonicalVenue}/${r.raceNumber}`)}
                  className="px-2.5 py-1 text-xs font-semibold"
                  style={{
                    background: String(r.raceNumber) === canonicalRaceNumber ? PAPER_CARD : "transparent",
                    color: INK,
                    border: `1px solid ${String(r.raceNumber) === canonicalRaceNumber ? INK : MUTED}`,
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
          <button onClick={() => navigate(`/${shiftDate(date, -1)}`)} className="flex-1 flex flex-col items-center gap-0.5 py-2">
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
              <button onClick={() => navigate(`/${today}`)} className="flex items-center gap-0.5 text-[0.625rem] font-semibold" style={{ color: INK, opacity: 0.75 }}>
                <RotateCcw size={10} />
                今日
              </button>
            )}
          </div>

          <button onClick={() => navigate(`/${shiftDate(date, 1)}`)} className="flex-1 flex flex-col items-center gap-0.5 py-2">
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

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<MeetingView />} />
      <Route path="/:date" element={<MeetingView />} />
      <Route path="/:date/:venue" element={<MeetingView />} />
      <Route path="/:date/:venue/:raceNumber" element={<MeetingView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
