import { useEffect, useMemo, useState } from "react";
import { fetchRaces } from "./lib/api";
import { formatDate, shiftDate, todayStr } from "./lib/date";
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
    if (!date) return;
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

  if (!date) return null;

  return (
    <div className="app">
      <header className="masthead">
        <h1>地方競馬新聞</h1>
        <div className="date-nav">
          <button onClick={() => setDate(shiftDate(date, -1))}>◀前日</button>
          <span className="current-date">{formatDate(date)}</span>
          <button onClick={() => setDate(shiftDate(date, 1))}>翌日▶</button>
          {date !== today && <button onClick={() => setDate(today)}>今日に戻る</button>}
        </div>
      </header>

      {loading && <p className="status">読み込み中...</p>}
      {error && <p className="status error">エラー: {error}</p>}
      {!loading && !error && races.length === 0 && <p className="status">この日の開催情報はありません。</p>}

      {venues.length > 0 && (
        <nav className="venue-tabs">
          {venues.map((v) => (
            <button key={v} className={v === venue ? "active" : ""} onClick={() => { setVenue(v); setRaceId(races.find((r) => r.venue === v)?.id); }}>
              {v}
            </button>
          ))}
        </nav>
      )}

      {racesAtVenue.length > 0 && (
        <nav className="race-tabs">
          {racesAtVenue.map((r) => (
            <button key={r.id} className={r.id === raceId ? "active" : ""} onClick={() => setRaceId(r.id)}>
              {r.raceNumber}R
            </button>
          ))}
        </nav>
      )}

      <main>
        <RaceCard race={selectedRace} />
      </main>
    </div>
  );
}
