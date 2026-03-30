import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, isAuthenticated, isAdmin } = useAuth();

  const [teamCode, setTeamCode] = useState("");
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    navigate(isAdmin ? "/admin" : "/puzzles", { replace: true });
  }, [isAdmin, isAuthenticated, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      await login(teamCode, teamName);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to start session.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg text-fg">
      <div className="mx-auto flex min-h-screen max-w-xl items-center px-4">
        <section className="w-full rounded-3xl border border-slate-700/50 bg-card p-8 shadow-2xl">
          <p className="text-xs uppercase tracking-[0.25em] text-muted">Puzzle Platform</p>
          <h1 className="mt-2 font-display text-3xl">Team Session Login</h1>
          <p className="mt-2 text-sm text-muted">Use your team code and registered team name.</p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm">
              <span className="mb-1 block">Team Code</span>
              <input
                className="w-full rounded-xl border border-slate-600 bg-slate-950/70 px-3 py-2"
                value={teamCode}
                onChange={(event) => setTeamCode(event.target.value)}
                placeholder="Enter your team code"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block">Team Name</span>
              <input
                className="w-full rounded-xl border border-slate-600 bg-slate-950/70 px-3 py-2"
                value={teamName}
                onChange={(event) => setTeamName(event.target.value)}
                placeholder="Enter your team name"
              />
            </label>
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
            >
              {loading ? "Starting..." : "Start Session"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
