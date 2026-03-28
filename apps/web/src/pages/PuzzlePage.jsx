import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardResponseSchema,
  EventStateResponseSchema,
  LeaderboardResponseSchema,
  NotepadResponseSchema,
  ProgressResponseSchema,
  PuzzleDetailResponseSchema,
  PuzzleListResponseSchema,
  PuzzleSubmitResponseSchema
} from "@puzzle-platform/contracts";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import TimerBar from "../components/TimerBar";
import DarkModeToggle from "../components/DarkModeToggle";
import ProgressTracker from "../components/ProgressTracker";
import ClipboardTray from "../components/ClipboardTray";
import HintModal from "../components/HintModal";
import ConfirmModal from "../components/ConfirmModal";
import ToolsPanel from "../components/ToolsPanel";
import CodeInterpreterPanel from "../components/CodeInterpreterPanel";
import { getApiBaseUrl } from "../services/apiBaseUrl";

export default function PuzzlePage() {
  const { team, logout } = useAuth();

  const [loading, setLoading] = useState(true);
  const [eventState, setEventState] = useState(null);
  const [progress, setProgress] = useState([]);
  const [puzzles, setPuzzles] = useState([]);
  const [selectedPuzzleId, setSelectedPuzzleId] = useState("");
  const [puzzleDetail, setPuzzleDetail] = useState(null);
  const [assetItems, setAssetItems] = useState([]);
  const [notepad, setNotepad] = useState("");
  const [clipboardEntries, setClipboardEntries] = useState([]);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [leaderboardRows, setLeaderboardRows] = useState([]);

  const [showHints, setShowHints] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(true);
  const antiCheatCooldownRef = useRef({
    tab_out: 0,
    window_blur: 0
  });
  const externalBypassUntilRef = useRef(0);
  const previousSelectedPuzzleIdRef = useRef("");

  const refreshCore = useCallback(async () => {
    const eventRes = await api.get("/event/state");
    const parsedEvent = EventStateResponseSchema.parse(eventRes.data);
    setEventState(parsedEvent);

    if (parsedEvent.enforcement?.isLocked || parsedEvent.enforcement?.isBanned) {
      setProgress([]);
      setPuzzles([]);
      setClipboardEntries([]);
      setAssetItems([]);
      setSelectedPuzzleId("");
      setPuzzleDetail(null);
      setLeaderboardRows([]);
      return;
    }

    const [progressRes, puzzlesRes, clipboardRes, leaderboardRes] = await Promise.all([
      api.get("/progress"),
      api.get("/puzzles"),
      api.get("/clipboard"),
      api.get("/leaderboard")
    ]);

    const parsedProgress = ProgressResponseSchema.parse(progressRes.data);
    const parsedPuzzles = PuzzleListResponseSchema.parse(puzzlesRes.data);
    const parsedClipboard = ClipboardResponseSchema.parse(clipboardRes.data);
    const parsedLeaderboard = LeaderboardResponseSchema.parse(leaderboardRes.data);

    setProgress(parsedProgress.items);
    setPuzzles(parsedPuzzles.puzzles);
    setClipboardEntries(parsedClipboard.entries);
    setLeaderboardRows(parsedLeaderboard.leaderboard);

    const visiblePuzzleIds = parsedPuzzles.puzzles.map((puzzle) => puzzle.id);
    if (visiblePuzzleIds.length === 0) {
      setSelectedPuzzleId("");
      setPuzzleDetail(null);
      setAssetItems([]);
      return;
    }

    if (!selectedPuzzleId || !visiblePuzzleIds.includes(selectedPuzzleId)) {
      const first = parsedPuzzles.puzzles.find((puzzle) => puzzle.status !== "solved") || parsedPuzzles.puzzles[0];
      setSelectedPuzzleId(first.id);
    }
  }, [selectedPuzzleId]);

  const refreshPuzzleDetail = useCallback(async () => {
    if (!selectedPuzzleId) {
      setAssetItems([]);
      return;
    }

    try {
      const [detailRes, notepadRes, assetsRes] = await Promise.all([
        api.get(`/puzzles/${selectedPuzzleId}`),
        api.get(`/puzzles/${selectedPuzzleId}/notepad`),
        api.get(`/puzzles/${selectedPuzzleId}/assets`)
      ]);

      const parsedDetail = PuzzleDetailResponseSchema.parse(detailRes.data);
      const parsedNotepad = NotepadResponseSchema.parse(notepadRes.data);
      const assetRows = Array.isArray(assetsRes.data?.items) ? assetsRes.data.items : [];

      setPuzzleDetail(parsedDetail.puzzle);
      setNotepad(parsedNotepad.content);
      setAssetItems(assetRows);
    } catch (requestError) {
      setPuzzleDetail(null);
      setAssetItems([]);
      setFeedback(requestError?.response?.data?.message || "Unable to load puzzle details.");
      if (requestError?.response?.status === 403) {
        await refreshCore();
      }
    }
  }, [refreshCore, selectedPuzzleId]);

  const enforcement = eventState?.enforcement;
  const isLocked = Boolean(enforcement?.isLocked);
  const isBanned = Boolean(enforcement?.isBanned);
  const lifelineActive = Boolean(enforcement?.lifelineActive);
  const lifelineRemainingSeconds = Number(enforcement?.lifelineRemainingSeconds || 0);
  const lifelinePuzzleId = enforcement?.lifelinePuzzleId || null;
  const isRestricted = isLocked || isBanned;
  const warnings = Number(enforcement?.warnings || 0);
  const maxWarnings = Number(enforcement?.maxWarnings || 3);

  const reportViolation = useCallback(
    async (type, detail) => {
      if (isRestricted || lifelineActive) {
        return;
      }

      const now = Date.now();
      if (now < externalBypassUntilRef.current) {
        return;
      }

      if (now - (antiCheatCooldownRef.current[type] || 0) < 2500) {
        return;
      }
      antiCheatCooldownRef.current[type] = now;

      try {
        const response = await api.post("/anti-cheat/violation", {
          type,
          detail,
          puzzleId: selectedPuzzleId || null
        });
        const message = response?.data?.message;
        if (message) {
          setFeedback(message);
        }
        await refreshCore();
      } catch (requestError) {
        setFeedback(requestError?.response?.data?.message || "Unable to report warning.");
      }
    },
    [isRestricted, lifelineActive, refreshCore, selectedPuzzleId]
  );

  const activateLifeline = async () => {
    if (!selectedPuzzleId) {
      setFeedback("Select a puzzle before activating lifeline.");
      return;
    }

    try {
      const response = await api.post("/lifeline/activate", { puzzleId: selectedPuzzleId });
      setFeedback(response?.data?.message || "Lifeline activated.");
      await refreshCore();
    } catch (requestError) {
      setFeedback(requestError?.response?.data?.message || "Unable to activate lifeline.");
    }
  };

  const handlePuzzleSelect = (id) => {
    if (!id) {
      return;
    }

    setSelectedPuzzleId(id);
    setToolsCollapsed(true);
    setFeedback("");
  };

  useEffect(() => {
    const previousPuzzleId = previousSelectedPuzzleIdRef.current;
    previousSelectedPuzzleIdRef.current = selectedPuzzleId;

    const hasSwitched = previousPuzzleId && previousPuzzleId !== selectedPuzzleId;
    if (!lifelineActive || !hasSwitched) {
      return;
    }

    api
      .post("/lifeline/puzzle-switch", {
        puzzleId: selectedPuzzleId || null
      })
      .then((response) => {
        if (response?.data?.cleared) {
          setFeedback(response?.data?.message || "Lifeline disabled because puzzle was switched.");
          refreshCore().catch(() => {});
        }
      })
      .catch(() => {});
  }, [lifelineActive, refreshCore, selectedPuzzleId]);

  const boot = useCallback(async () => {
    try {
      await refreshCore();
      setError("");
    } catch (requestError) {
      if (requestError?.response?.status === 401) {
        await logout();
      }
      setError(requestError?.response?.data?.message || "Unable to load event state.");
    } finally {
      setLoading(false);
    }
  }, [logout, refreshCore]);

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    if (!selectedPuzzleId) {
      return;
    }
    refreshPuzzleDetail();
  }, [refreshPuzzleDetail, selectedPuzzleId]);

  useEffect(() => {
    const interval = setInterval(() => {
      refreshCore().catch(() => {});
    }, 10000);

    return () => clearInterval(interval);
  }, [refreshCore]);

  useEffect(() => {
    if (isRestricted) {
      return undefined;
    }

    const onVisibility = () => {
      if (document.hidden) {
        reportViolation("tab_out", "Document hidden/tab switched.");
      }
    };

    const onBlur = () => {
      reportViolation("window_blur", "Window lost focus.");
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
    };
  }, [isRestricted, reportViolation]);

  useEffect(() => {
    if (!selectedPuzzleId || isRestricted) {
      return;
    }

    const timeout = setTimeout(() => {
      api
        .post(`/puzzles/${selectedPuzzleId}/notepad`, { content: notepad })
        .then((response) => NotepadResponseSchema.parse(response.data))
        .catch(() => {});
    }, 500);

    return () => clearTimeout(timeout);
  }, [isRestricted, notepad, selectedPuzzleId]);

  const submitAnswer = async () => {
    if (isRestricted) {
      setFeedback(isBanned ? "Team is banned by the administrator." : "Team is locked due to anti-cheat violations.");
      setShowConfirm(false);
      return;
    }

    try {
      const response = await api.post(`/puzzles/${selectedPuzzleId}/submit`, { answer });
      const parsed = PuzzleSubmitResponseSchema.parse(response.data);
      const pointsNote =
        parsed.pointsAwarded > 0
          ? ` +${parsed.pointsAwarded} pts (Total: ${parsed.totalPoints})`
          : parsed.result === "correct"
            ? ` Total: ${parsed.totalPoints} pts`
            : "";
      setFeedback(`${parsed.message}${pointsNote}`.trim());
      setShowConfirm(false);
      setAnswer("");
      await refreshCore();
      await refreshPuzzleDetail();
    } catch (requestError) {
      setFeedback(requestError?.response?.data?.message || "Submit failed");
      setShowConfirm(false);
    }
  };

  const revealHint = async (tier) => {
    if (isRestricted) {
      setFeedback(isBanned ? "Team is banned by the administrator." : "Team is locked due to anti-cheat violations.");
      return;
    }

    try {
      await api.post(`/puzzles/${selectedPuzzleId}/hints/${tier}/reveal`);
      await refreshCore();
      await refreshPuzzleDetail();
    } catch (requestError) {
      setFeedback(requestError?.response?.data?.message || "Hint reveal failed.");
    }
  };

  const markPuzzleUnsolved = async () => {
    if (!selectedPuzzleId || isRestricted) {
      return;
    }

    try {
      const response = await api.post(`/puzzles/${selectedPuzzleId}/unsolve`);
      setFeedback(response?.data?.message || "Puzzle marked as unsolved.");
      await refreshCore();
      await refreshPuzzleDetail();
    } catch (requestError) {
      setFeedback(requestError?.response?.data?.message || "Unable to mark puzzle as unsolved.");
    }
  };

  const pushClipboard = async (value, source = "manual") => {
    if (!value || isRestricted) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Browser copy is best effort.
    }

    try {
      const response = await api.post("/clipboard", { value, source });
      const parsed = ClipboardResponseSchema.parse(response.data);
      setClipboardEntries(parsed.entries);
    } catch {
      // Persist failure should not block tool usage.
    }
  };

  const selectedPuzzle = useMemo(
    () => puzzles.find((item) => item.id === selectedPuzzleId) || null,
    [puzzles, selectedPuzzleId]
  );
  const yourLeaderboardRow = useMemo(
    () => leaderboardRows.find((entry) => entry.team?.id === team?.id) || null,
    [leaderboardRows, team?.id]
  );
  const unlockedPuzzleIds = useMemo(() => puzzles.map((item) => item.id), [puzzles]);
  const shouldShowInterpreter = useMemo(() => {
    if (!puzzleDetail) {
      return false;
    }

    const builtins = puzzleDetail?.toolConfig?.builtinUtils || [];
    if (
      builtins.includes("codeWorkspace") ||
      builtins.includes("pythonInterpreter") ||
      builtins.includes("codeVerifier")
    ) {
      return true;
    }

    const type = `${puzzleDetail.type || ""}`.toLowerCase();
    if (["fix_errors", "code", "programming", "scripting"].includes(type)) {
      return true;
    }

    return assetItems.some((item) => `${item.name || ""}`.toLowerCase().endsWith(".py"));
  }, [assetItems, puzzleDetail]);
  const apiBase = getApiBaseUrl();

  const resolveExternalUrl = (rawUrl) => {
    const value = `${rawUrl || ""}`.trim();
    if (!value) {
      return "";
    }

    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    return `${apiBase}${value.startsWith("/") ? value : `/${value}`}`;
  };

  const launchExternal = (link) => {
    const resolvedUrl = resolveExternalUrl(link?.url);
    if (!resolvedUrl) {
      return;
    }

    if (link.download) {
      const anchor = document.createElement("a");
      anchor.href = resolvedUrl;
      anchor.target = link.openInNewTab === false ? "_self" : "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.download = "";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return;
    }

    if (link.openInNewTab === false) {
      window.location.href = resolvedUrl;
      return;
    }

    window.open(resolvedUrl, "_blank", "noopener,noreferrer");
  };

  const openChallengePage = () => {
    if (!puzzleDetail) return;
    const path = puzzleDetail.toolConfig.isolatedUrl || `/challenge/${puzzleDetail.slug}`;
    externalBypassUntilRef.current = Date.now() + 10000;
    window.open(`${apiBase}${path}`, "_blank", "noopener,noreferrer");
  };

  const openPrimaryExternalTool = () => {
    const primary = puzzleDetail?.toolConfig?.externalLinks?.[0];
    if (!primary?.url) {
      return;
    }

    externalBypassUntilRef.current = Date.now() + 20000;
    launchExternal(primary);
  };

  const handleExternalLaunch = (link) => {
    if (!link?.url) {
      return;
    }

    externalBypassUntilRef.current = Date.now() + 20000;
    launchExternal(link);
  };

  const handleAssetLaunch = () => {
    externalBypassUntilRef.current = Date.now() + 20000;
  };

  const hasConfiguredTools =
    Boolean(puzzleDetail?.toolConfig?.builtinUtils?.length) ||
    Boolean(puzzleDetail?.toolConfig?.externalLinks?.length);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-fg">
        <p>Loading event workspace...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg pb-16 pt-14 text-fg">
      <TimerBar
        remainingSeconds={eventState?.remainingSeconds || 0}
        penaltiesPoints={eventState?.penaltiesPoints || 0}
        isPaused={Boolean(eventState?.competition?.isPaused)}
      />

      <div className="mx-auto max-w-7xl px-4 py-5 md:px-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-700/40 bg-card p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Team Session</p>
            <h1 className="font-display text-2xl">{team?.name}</h1>
          </div>
          <div className="flex items-center gap-2">
            <DarkModeToggle />
            <button type="button" className="rounded-xl border border-slate-500 px-3 py-2 text-sm" onClick={logout}>
              Logout
            </button>
          </div>
        </header>

        {error ? <p className="mb-3 rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p> : null}
        {feedback ? <p className="mb-3 rounded-lg bg-sky-950/40 p-3 text-sm text-sky-200">{feedback}</p> : null}
        <p
          className={`mb-3 rounded-lg p-3 text-sm ${
            isRestricted ? "bg-red-950/40 text-red-300" : "bg-amber-950/30 text-amber-200"
          }`}
        >
          Anti-cheat warnings: {warnings}/{maxWarnings}
          {isBanned
            ? " - Team is banned by admin."
            : lifelineActive
              ? ` - Lifeline active (${lifelineRemainingSeconds}s left${
                  lifelinePuzzleId ? ` for current puzzle` : ""
                }). Anti-cheat is bypassed.`
              : isLocked
                ? " - Team is locked for this event."
                : " - Tab switching/window blur issues warnings."}
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={activateLifeline}
            disabled={isBanned || !selectedPuzzleId || lifelineActive}
            className="rounded-lg border border-cyan-400/70 px-3 py-2 text-sm disabled:opacity-50"
          >
            {lifelineActive ? "Lifeline Active" : "Use Lifeline (5 min)"}
          </button>
          <p className="text-xs text-muted">
            Lifeline disables anti-cheat for 5 minutes and ends immediately when you switch puzzles.
          </p>
        </div>

        <ProgressTracker
          items={progress}
          selectedPuzzleId={selectedPuzzleId}
          enabledPuzzleIds={unlockedPuzzleIds}
          onSelect={handlePuzzleSelect}
        />

        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
          <section className="space-y-4">
            <article className="rounded-2xl border border-slate-700/40 bg-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted">Puzzle</p>
                  <h2 className="font-display text-2xl">{selectedPuzzle?.title || "Select a puzzle"}</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-amber-400/70 px-3 py-2 text-sm"
                    onClick={() => setShowHints(true)}
                    disabled={!puzzleDetail || isRestricted}
                  >
                    Hints
                  </button>
                  {puzzleDetail?.progress?.status === "solved" ? (
                    <button
                      type="button"
                      className="rounded-lg border border-rose-400/70 px-3 py-2 text-sm"
                      onClick={markPuzzleUnsolved}
                      disabled={isRestricted}
                    >
                      Mark Unsolved
                    </button>
                  ) : null}
                  {puzzleDetail?.toolConfig?.isInspectPuzzle ? (
                    <button
                      type="button"
                      onClick={openChallengePage}
                      className="rounded-lg border border-sky-400/70 px-3 py-2 text-sm"
                      disabled={isRestricted}
                    >
                      Open Challenge Page
                    </button>
                  ) : null}
                  {puzzleDetail?.toolConfig?.externalLinks?.length ? (
                    <button
                      type="button"
                      onClick={openPrimaryExternalTool}
                      className="rounded-lg border border-emerald-400/70 px-3 py-2 text-sm"
                      disabled={isRestricted}
                    >
                      Open External Tool
                    </button>
                  ) : null}
                </div>
              </div>

              <p className="whitespace-pre-wrap text-slate-100">{puzzleDetail?.prompt}</p>
            </article>

            <section className="rounded-2xl border border-slate-700/40 bg-card p-5">
              <h3 className="mb-2 font-semibold">Puzzle Files</h3>
              {assetItems.length === 0 ? (
                <p className="text-sm text-muted">No files attached to this puzzle.</p>
              ) : (
                <div className="space-y-3">
                  {assetItems.map((item) => {
                    const href = `${apiBase}${item.url}`;
                    return (
                      <article key={item.relativePath} className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-slate-100">{item.name}</p>
                            <p className="text-xs text-muted">{item.relativePath}</p>
                          </div>
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            onClick={handleAssetLaunch}
                            className="rounded-md border border-slate-500 px-3 py-1 text-xs text-sky-300"
                          >
                            Open File
                          </a>
                        </div>
                        {item.mediaType === "audio" ? (
                          <audio className="mt-3 w-full" controls src={href} preload="metadata" />
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-700/40 bg-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">Tools</h3>
                {hasConfiguredTools ? (
                  <button
                    type="button"
                    className="rounded-md border border-slate-500 px-3 py-1 text-sm"
                    onClick={() => setToolsCollapsed((value) => !value)}
                  >
                    {toolsCollapsed ? "Expand" : "Collapse"}
                  </button>
                ) : null}
              </div>

              {!hasConfiguredTools ? (
                <p className="text-sm text-muted">
                  No in-platform tools are required for this puzzle. Use puzzle content and answer input only.
                </p>
              ) : null}

              {isRestricted ? (
                <p className="text-sm text-red-300">
                  Tools are disabled because this team is restricted.
                </p>
              ) : null}

              {toolsCollapsed || !puzzleDetail || !hasConfiguredTools || isRestricted ? null : (
                <ToolsPanel
                  toolConfig={puzzleDetail.toolConfig}
                  onCopy={(value, source) => pushClipboard(value, source)}
                  onExternalLaunch={handleExternalLaunch}
                />
              )}
            </section>

            {shouldShowInterpreter ? (
              <CodeInterpreterPanel
                puzzleId={selectedPuzzleId}
                puzzleType={puzzleDetail?.type}
                toolConfig={puzzleDetail?.toolConfig}
                assetItems={assetItems}
                disabled={isRestricted || !selectedPuzzleId}
              />
            ) : null}

            <section className="rounded-2xl border border-slate-700/40 bg-card p-5">
              <h3 className="mb-2 font-semibold">Answer Submission</h3>
              <textarea
                className="h-24 w-full rounded-xl border border-slate-600 bg-slate-950/70 p-3"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Enter final answer"
                disabled={isRestricted}
              />
              <button
                type="button"
                className="mt-3 rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950"
                onClick={() => setShowConfirm(true)}
                disabled={!answer.trim() || !selectedPuzzleId || isRestricted}
              >
                Submit Answer
              </button>
            </section>
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-slate-700/40 bg-card p-4">
              <h3 className="mb-2 font-semibold">Leaderboard</h3>
              {yourLeaderboardRow ? (
                <p className="mb-2 text-xs text-cyan-200">
                  Your Rank: #{yourLeaderboardRow.rank} | Points: {yourLeaderboardRow.totalPoints}
                </p>
              ) : null}
              {leaderboardRows.length === 0 ? (
                <p className="text-sm text-muted">No leaderboard data yet.</p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-auto">
                  {leaderboardRows.slice(0, 12).map((entry) => (
                    <section
                      key={entry.team.id}
                      className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold">
                          #{entry.rank} {entry.team.name}
                        </p>
                        <p className="text-emerald-300">{entry.totalPoints} pts</p>
                      </div>
                      <p className="text-muted">
                        {entry.team.code} | Solved: {entry.solvedCount} | Hint penalties: {entry.penaltiesPoints} pts
                      </p>
                    </section>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-slate-700/40 bg-card p-4">
              <h3 className="mb-2 font-semibold">Scratch Notepad</h3>
              <p className="mb-2 text-xs text-muted">Autosaves after 500ms.</p>
              <textarea
                className="h-72 w-full rounded-xl border border-slate-600 bg-slate-950/70 p-3 font-mono text-sm"
                value={notepad}
                onChange={(event) => setNotepad(event.target.value)}
                disabled={isRestricted}
              />
            </section>

            <ClipboardTray entries={clipboardEntries} />
          </aside>
        </div>
      </div>

      <HintModal
        open={showHints}
        hints={puzzleDetail?.hints || []}
        onClose={() => setShowHints(false)}
        onReveal={revealHint}
      />

      <ConfirmModal
        open={showConfirm}
        title="Confirm Submission"
        body="Submit this answer now? This action records an attempt."
        onConfirm={submitAnswer}
        onCancel={() => setShowConfirm(false)}
      />
    </main>
  );
}
