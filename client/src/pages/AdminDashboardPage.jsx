import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

function formatTime(totalSeconds) {
  const safe = Math.max(totalSeconds, 0);
  const minutes = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const puzzleBasePath = import.meta.env.VITE_PUZZLE_BASE_PATH || "/puzzles";

export default function AdminDashboardPage() {
  const { logout } = useAuth();
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [auditLog, setAuditLog] = useState([]);
  const [auditPagination, setAuditPagination] = useState(null);
  const [importFeedback, setImportFeedback] = useState("");
  const [folderPath, setFolderPath] = useState(puzzleBasePath);
  const [replaceImported, setReplaceImported] = useState(true);
  const [replaceAllPuzzles, setReplaceAllPuzzles] = useState(true);
  const [timerInputs, setTimerInputs] = useState({});
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [teamDetails, setTeamDetails] = useState(null);
  const [teamDetailPagination, setTeamDetailPagination] = useState(null);
  const [selectedTeamIds, setSelectedTeamIds] = useState([]);
  const [confirmAction, setConfirmAction] = useState(null);
  const [bulkReason, setBulkReason] = useState("");
  const [filters, setFilters] = useState({
    status: "all",
    minScore: "",
    maxScore: "",
    minViolations: "",
    teamName: ""
  });
  const [auditPage, setAuditPage] = useState(1);
  const [detailPage, setDetailPage] = useState(1);

  const fetchOverview = async (requestedAuditPage = 1) => {
    try {
      const [overviewResponse, auditResponse] = await Promise.all([
        api.get("/admin/overview"),
        api.get(`/admin/audit-log?page=${requestedAuditPage}&pageSize=20`)
      ]);
      setSnapshot(overviewResponse.data);
      const entries = auditResponse.data.entries || [];
      setAuditLog((prev) => (requestedAuditPage === 1 ? entries : [...prev, ...entries]));
      setAuditPagination(auditResponse.data.pagination || null);
      setError("");
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to load dashboard.");
    }
  };

  useEffect(() => {
    fetchOverview(1);
  }, []);

  useEffect(() => {
    const socket = io(serverUrl, { transports: ["websocket"] });

    socket.on("dashboard:update", (data) => {
      setSnapshot(data);
    });

    socket.on("connect_error", () => {
      setError("Live updates disconnected. Refreshing every few seconds.");
    });

    const fallback = setInterval(() => {
      setAuditPage(1);
      fetchOverview(1);
    }, 5000);

    return () => {
      clearInterval(fallback);
      socket.disconnect();
    };
  }, []);

  const leaderboard = useMemo(() => snapshot?.leaderboard || [], [snapshot]);
  const teams = useMemo(() => snapshot?.teams || [], [snapshot]);

  const filteredTeams = useMemo(() => {
    return teams.filter((team) => {
      if (filters.status !== "all" && team.status !== filters.status) {
        return false;
      }

      if (filters.teamName.trim()) {
        const q = filters.teamName.trim().toLowerCase();
        const matches = team.team_name.toLowerCase().includes(q) || team.team_id.toLowerCase().includes(q);
        if (!matches) {
          return false;
        }
      }

      const minScore = filters.minScore === "" ? null : Number(filters.minScore);
      const maxScore = filters.maxScore === "" ? null : Number(filters.maxScore);
      const minViolations = filters.minViolations === "" ? null : Number(filters.minViolations);

      if (minScore !== null && team.score < minScore) {
        return false;
      }
      if (maxScore !== null && team.score > maxScore) {
        return false;
      }
      if (minViolations !== null && team.violation_count < minViolations) {
        return false;
      }

      return true;
    });
  }, [teams, filters]);

  const skipPuzzle = async (teamId) => {
    try {
      await api.post(`/admin/team/${teamId}/skip`);
      setAuditPage(1);
      await fetchOverview(1);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to skip puzzle.");
    }
  };

  const adjustTimer = async (teamId) => {
    const value = Number(timerInputs[teamId] || 0);
    try {
      await api.post(`/admin/team/${teamId}/timer`, { remainingSeconds: value });
      setAuditPage(1);
      await fetchOverview(1);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to adjust timer.");
    }
  };

  const fetchTeamDetails = async (teamId, requestedPage = 1) => {
    setSelectedTeamId(teamId);
    try {
      const response = await api.get(`/admin/team/${teamId}/details?page=${requestedPage}&pageSize=10`);
      const data = response.data;
      setTeamDetailPagination(data.pagination || null);
      setTeamDetails((prev) => {
        if (requestedPage === 1 || !prev || prev.team?.team_id !== teamId) {
          return data;
        }

        return {
          ...data,
          assignments: [...(prev.assignments || []), ...(data.assignments || [])],
          submissions: [...(prev.submissions || []), ...(data.submissions || [])],
          violations: [...(prev.violations || []), ...(data.violations || [])]
        };
      });
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to load team details.");
    }
  };

  const runBulkAction = async (action) => {
    try {
      await api.post("/admin/bulk-action", {
        action,
        teamIds: selectedTeamIds,
        reason: bulkReason || undefined
      });
      setSelectedTeamIds([]);
      setBulkReason("");
      setConfirmAction(null);
      setAuditPage(1);
      await fetchOverview(1);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Bulk action failed.");
    }
  };

  const toggleTeam = (teamId) => {
    setSelectedTeamIds((prev) =>
      prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId]
    );
  };

  const togglePause = async () => {
    try {
      if (snapshot?.competition?.is_paused) {
        await api.post("/admin/timer/resume", { reason: "Admin resumed competition" });
      } else {
        await api.post("/admin/timer/pause", { reason: "Admin paused competition" });
      }
      setAuditPage(1);
      await fetchOverview(1);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to update competition timer.");
    }
  };

  const syncPuzzleBank = async () => {
    setImportFeedback("");

    try {
      const response = await api.post("/admin/sync-puzzle-bank", {
        folderPath,
        replaceExistingFromSource: replaceImported,
        replaceAllPuzzles
      });
      setImportFeedback(response.data.message || "Puzzle bank sync completed.");
      setAuditPage(1);
      await fetchOverview(1);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to sync puzzle bank.");
    }
  };

  const loadMoreAudit = async () => {
    if (!auditPagination?.has_next) {
      return;
    }
    const nextPage = Number(auditPagination.page || auditPage) + 1;
    setAuditPage(nextPage);
    await fetchOverview(nextPage);
  };

  const loadMoreTeamDetails = async () => {
    if (!selectedTeamId || !teamDetailPagination) {
      return;
    }

    const hasMore =
      teamDetailPagination.assignments?.has_next ||
      teamDetailPagination.submissions?.has_next ||
      teamDetailPagination.violations?.has_next;

    if (!hasMore) {
      return;
    }

    const nextPage = Number(teamDetailPagination.page || detailPage) + 1;
    setDetailPage(nextPage);
    await fetchTeamDetails(selectedTeamId, nextPage);
  };

  return (
    <main className="page-shell admin-page">
      <section className="top-bar">
        <div>
          <span className="eyebrow">Event Management</span>
          <h1>Admin Dashboard</h1>
        </div>
        <button className="btn btn-muted" onClick={logout}>
          Disconnect
        </button>
      </section>

      {error && <p className="error-text" style={{ marginBottom: '20px' }}>{error}</p>}

      <section className="card" style={{ marginBottom: '32px' }}>
        <span className="eyebrow">Puzzle Repository</span>
        <h2 style={{ marginBottom: '16px' }}>Bank Configuration</h2>
        <div className="form-grid">
          <input
            className="zip-path-input"
            type="text"
            value={folderPath}
            onChange={(event) => setFolderPath(event.target.value)}
            placeholder="/puzzles"
            style={{ width: '100%', maxWidth: '800px' }}
          />
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={replaceImported}
                onChange={(event) => setReplaceImported(event.target.checked)}
              />
              Update Active Source
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={replaceAllPuzzles}
                onChange={(event) => setReplaceAllPuzzles(event.target.checked)}
              />
              Reset All Progress
            </label>
          </div>
          <button className="btn btn-primary" onClick={syncPuzzleBank} style={{ width: 'fit-content' }}>
            Sync Puzzles
          </button>
          <button className="btn btn-outline" onClick={togglePause} style={{ width: 'fit-content' }}>
            {snapshot?.competition?.is_paused ? "Resume Competition" : "Pause Competition"}
          </button>
        </div>
        {importFeedback && <p className="info-text" style={{ marginTop: '16px' }}>{importFeedback}</p>}
      </section>

      <section className="card" style={{ marginBottom: '24px' }}>
        <span className="eyebrow">Filters</span>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' }}>
          <label>
            Team Status
            <select value={filters.status} onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}>
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="disqualified">Disqualified</option>
              <option value="finished">Finished</option>
            </select>
          </label>
          <label>
            Min Score
            <input type="number" value={filters.minScore} onChange={(event) => setFilters((prev) => ({ ...prev, minScore: event.target.value }))} />
          </label>
          <label>
            Max Score
            <input type="number" value={filters.maxScore} onChange={(event) => setFilters((prev) => ({ ...prev, maxScore: event.target.value }))} />
          </label>
          <label>
            Min Violations
            <input type="number" value={filters.minViolations} onChange={(event) => setFilters((prev) => ({ ...prev, minViolations: event.target.value }))} />
          </label>
          <label>
            Team Search
            <input type="text" value={filters.teamName} onChange={(event) => setFilters((prev) => ({ ...prev, teamName: event.target.value }))} placeholder="Team name or ID" />
          </label>
        </div>
      </section>

      <section className="stats-grid">
        <article className="card stat-card">
          <p className="label">Active Teams</p>
          <h2>{snapshot?.teams?.length || 0}</h2>
        </article>
        <article className="card stat-card">
          <p className="label">Live Events</p>
          <h2>{snapshot?.recent_events?.length || 0}</h2>
        </article>
        <article className="card stat-card">
          <p className="label">System Updated</p>
          <h2>{snapshot?.updated_at ? new Date(snapshot.updated_at).toLocaleTimeString() : "-"}</h2>
        </article>
      </section>

      <section className="grid-two">
        <article className="card" style={{ padding: '24px' }}>
          <span className="eyebrow">Team Monitoring</span>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '12px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-muted"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
              disabled={selectedTeamIds.length === 0}
              onClick={() => setConfirmAction("disqualify")}
            >
              Bulk Disqualify
            </button>
            <button
              className="btn btn-outline"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
              disabled={selectedTeamIds.length === 0}
              onClick={() => setConfirmAction("reset_progress")}
            >
              Bulk Reset Progress
            </button>
            <button
              className="btn btn-accent"
              style={{ padding: '8px 12px', fontSize: '0.85rem' }}
              disabled={selectedTeamIds.length === 0}
              onClick={() => setConfirmAction("notify")}
            >
              Bulk Send Notification
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Team</th>
                  <th>Status</th>
                  <th>Puzzle</th>
                  <th>Time Left</th>
                  <th>Attempts</th>
                  <th>Violations</th>
                  <th>Lifelines</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTeams.map((team) => (
                  <tr
                    key={team.team_id}
                    onClick={() => {
                      setDetailPage(1);
                      fetchTeamDetails(team.team_id, 1);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedTeamIds.includes(team.team_id)}
                        onChange={() => toggleTeam(team.team_id)}
                      />
                    </td>
                    <td>
                      <strong>{team.team_name}</strong>
                      <p className="muted mono" style={{ fontSize: '0.75rem' }}>{team.team_id}</p>
                    </td>
                    <td>{team.status}</td>
                    <td><span className="mono" style={{ color: 'var(--accent-secondary)' }}>{team.active_puzzle_id || "-"}</span></td>
                    <td><span className={team.remaining_seconds <= 60 ? "danger-text" : ""}>{formatTime(team.remaining_seconds)}</span></td>
                    <td>{team.attempts}</td>
                    <td>{team.violation_count}</td>
                    <td>{team.lifeline_remaining}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <button className="btn btn-muted" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => skipPuzzle(team.team_id)}>
                          Skip
                        </button>
                        <input
                          type="number"
                          min="0"
                          placeholder="sec"
                          value={timerInputs[team.team_id] || ""}
                          style={{ width: '70px', padding: '6px' }}
                          onChange={(event) =>
                            setTimerInputs((prev) => ({
                              ...prev,
                              [team.team_id]: event.target.value
                            }))
                          }
                        />
                        <button className="btn btn-outline" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => adjustTimer(team.team_id)}>
                          Set
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="card" style={{ padding: '24px' }}>
          <span className="eyebrow">Global Leaderboard</span>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Team</th>
                  <th>Solved</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((team, index) => (
                  <tr key={team.team_id}>
                    <td><span className="mono" style={{ color: index === 0 ? 'var(--accent-secondary)' : 'inherit' }}>#{index + 1}</span></td>
                    <td><strong>{team.team_name}</strong></td>
                    <td>{team.solved_count}</td>
                    <td><span style={{ fontWeight: '600' }}>{team.score}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="card" style={{ marginTop: '24px', padding: '24px' }}>
        <span className="eyebrow">Audit Log</span>
        <div style={{ maxHeight: '300px', overflowY: 'auto', marginTop: '16px', display: 'grid', gap: '8px' }}>
          {auditLog.map((event, index) => (
            <article key={`${event.timestamp}-${index}`} style={{ padding: '12px', background: 'rgba(20, 13, 26, 0.4)', borderRadius: '8px', border: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ fontSize: '0.9rem' }}>
                  <strong>{event.adminId}</strong>: <span className="muted">{event.action}</span>
                  {event.team_id ? ` (${event.team_id})` : ""}
                </p>
              </div>
              <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(event.timestamp).toLocaleTimeString()}</span>
            </article>
          ))}
        </div>
        {auditPagination?.has_next && (
          <button className="btn btn-outline" style={{ marginTop: '12px' }} onClick={loadMoreAudit}>
            Load More Audit Entries
          </button>
        )}
      </section>

      {teamDetails && (
        <section className="card" style={{ marginTop: '24px' }}>
          <span className="eyebrow">Team Drilldown</span>
          <h2 style={{ marginBottom: '16px' }}>{teamDetails.team.team_name} ({selectedTeamId})</h2>
          <p className="muted" style={{ marginBottom: '12px' }}>
            Score: {teamDetails.score.score} | Time Penalty: {teamDetails.score.penaltySeconds}s | Violations: {teamDetails.violations.length}
          </p>
          <div className="table-wrap" style={{ marginBottom: '14px' }}>
            <table>
              <thead>
                <tr>
                  <th>Puzzle</th>
                  <th>Status</th>
                  <th>Elapsed</th>
                </tr>
              </thead>
              <tbody>
                {teamDetails.assignments.map((assignment) => (
                  <tr key={`${assignment.puzzle_id}-${assignment.start_time}`}>
                    <td>{assignment.puzzle_id}</td>
                    <td>{assignment.status}</td>
                    <td>{formatTime(assignment.elapsed_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap" style={{ marginBottom: '14px' }}>
            <table>
              <thead>
                <tr>
                  <th>Submission Time</th>
                  <th>Puzzle</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {teamDetails.submissions.map((submission, index) => (
                  <tr key={`${submission.timestamp}-${index}`}>
                    <td>{new Date(submission.timestamp).toLocaleString()}</td>
                    <td>{submission.puzzle_id}</td>
                    <td>{submission.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(teamDetailPagination?.assignments?.has_next ||
            teamDetailPagination?.submissions?.has_next ||
            teamDetailPagination?.violations?.has_next) && (
            <button className="btn btn-outline" onClick={loadMoreTeamDetails}>
              Load More Drilldown Data
            </button>
          )}
        </section>
      )}

      {confirmAction && (
        <div className="modal-backdrop">
          <div className="card" style={{ maxWidth: '560px', margin: '0 auto' }}>
            <h2 style={{ marginBottom: '12px' }}>Confirm Bulk Action</h2>
            <p className="muted" style={{ marginBottom: '12px' }}>
              You are about to apply <strong>{confirmAction}</strong> to {selectedTeamIds.length} team(s).
            </p>
            <label>
              Reason (optional)
              <input type="text" value={bulkReason} onChange={(event) => setBulkReason(event.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
              <button className="btn btn-primary" onClick={() => runBulkAction(confirmAction)}>Confirm</button>
              <button className="btn btn-muted" onClick={() => setConfirmAction(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
