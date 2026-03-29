import { useEffect, useState } from "react";
import TimerBar from "../components/TimerBar";
import api from "../services/api";
import { getApiBaseUrl } from "../services/apiBaseUrl";

function formatDuration(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined) {
    return "--:--:--";
  }

  const safe = Math.max(0, Number(totalSeconds || 0));
  const hours = Math.floor(safe / 3600)
    .toString()
    .padStart(2, "0");
  const minutes = Math.floor((safe % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const seconds = Math.floor(safe % 60)
    .toString()
    .padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export default function LeaderboardPage() {
  const apiBase = getApiBaseUrl();
  const [eventState, setEventState] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const [eventRes, leaderboardRes] = await Promise.all([
          api.get("/public/event-state"),
          api.get("/leaderboard")
        ]);
        setEventState(eventRes.data);
        setRows(Array.isArray(leaderboardRes.data?.leaderboard) ? leaderboardRes.data.leaderboard : []);
        setError("");
      } catch (requestError) {
        setError(requestError?.response?.data?.message || "Unable to load leaderboard.");
      }
    };

    load().catch(() => {});
    const source = new EventSource(`${apiBase}/events/stream`, { withCredentials: false });
    source.addEventListener("snapshot", (event) => {
      try {
        const parsed = JSON.parse(event.data);
        setEventState(parsed?.eventState || null);
        setRows(Array.isArray(parsed?.leaderboard) ? parsed.leaderboard : []);
      } catch {
        // Ignore malformed frames.
      }
    });
    source.onerror = () => {};
    return () => source.close();
  }, [apiBase]);

  return (
    <main className="min-h-screen bg-bg pb-10 pt-14 text-fg">
      <TimerBar
        remainingSeconds={eventState?.remainingSeconds || 0}
        isPaused={Boolean(eventState?.competition?.isPaused)}
        isTimeUp={Boolean(eventState?.competition?.isTimeUp)}
      />

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-6">
        <header className="mb-6 rounded-3xl border border-slate-700/40 bg-card p-6">
          <p className="text-xs uppercase tracking-[0.25em] text-muted">Public Leaderboard</p>
          <h1 className="mt-2 font-display text-4xl">{eventState?.event?.name || "Puzzle Event"}</h1>
          <p className="mt-2 text-sm text-muted">
            Ranking: solved desc, hint penalty asc, total time asc.
          </p>
        </header>

        {error ? <p className="mb-4 rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p> : null}

        <section className="rounded-3xl border border-slate-700/40 bg-card p-4">
          {rows.length === 0 ? (
            <p className="p-4 text-sm text-muted">No leaderboard entries yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left">
                <thead>
                  <tr className="border-b border-slate-700/40 text-sm text-muted">
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Team</th>
                    <th className="px-4 py-3">Solved</th>
                    <th className="px-4 py-3">Hint Penalty</th>
                    <th className="px-4 py-3">Total Time</th>
                    <th className="px-4 py-3">Last Correct</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.team.id} className="border-b border-slate-800/50 text-sm">
                      <td className="px-4 py-4 font-display text-2xl text-amber-300">#{row.rank}</td>
                      <td className="px-4 py-4">
                        <p className="font-semibold text-slate-100">{row.team.name}</p>
                        <p className="text-xs text-muted">{row.team.code}</p>
                      </td>
                      <td className="px-4 py-4 text-lg font-semibold">{row.solvedCount}</td>
                      <td className="px-4 py-4">{row.hintPenaltyPoints} pts</td>
                      <td className="px-4 py-4">{formatDuration(row.totalElapsedSeconds)}</td>
                      <td className="px-4 py-4 text-xs text-muted">
                        {row.lastCorrectAt ? new Date(row.lastCorrectAt).toLocaleTimeString() : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
