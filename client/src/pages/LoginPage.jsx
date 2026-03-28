import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function LoginPage() {
  const navigate = useNavigate();
  const { loginTeam, isAuthenticated, isAdmin } = useAuth();

  const [teamId, setTeamId] = useState("");
  const [password, setPassword] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      navigate(isAdmin ? "/admin" : "/play", { replace: true });
    }
  }, [isAuthenticated, isAdmin, navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await loginTeam(teamId.trim(), password, adminMode);
      navigate(adminMode ? "/admin" : "/play", { replace: true });
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Login failed. Please check credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="page-shell auth-page">
      <section className="card auth-card">
        <div className="card-header">
          <span className="eyebrow">Puzzle Event Platform</span>
          <h1>{adminMode ? "Admin Access" : "Team Login"}</h1>
          <p className="muted">
            Secure access with timed puzzle assignments, live validation, and controlled lifeline unlocks.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="form-grid">
          <label>
            Team ID
            <input
              type="text"
              placeholder={adminMode ? "ADMIN" : "T001"}
              value={teamId}
              onChange={(event) => setTeamId(event.target.value)}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={adminMode}
              onChange={(event) => setAdminMode(event.target.checked)}
            />
            Login as Admin
          </label>

          {error && <p className="error-text">{error}</p>}

          <button className="btn btn-primary" style={{ width: '100%' }} type="submit" disabled={loading}>
            {loading ? "Entering..." : "Enter Platform"}
          </button>
        </form>

        <div className="card" style={{ marginTop: '32px', padding: '20px', background: 'rgba(0, 0, 0, 0.2)' }}>
          <h3 style={{ fontSize: '0.9rem', color: 'var(--accent-cyan)', marginBottom: '8px' }}>Access Protocol</h3>
          <p className="muted" style={{ fontSize: '0.85rem' }}>Teams: T001, T002, T003 (Pass: alpha123/code123/mystic123)</p>
          <p className="muted" style={{ fontSize: '0.85rem' }}>Admin: ADMIN / admin123</p>
        </div>
      </section>
    </main>
  );
}
