import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardResponseSchema,
  EventStateResponseSchema,
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

function mergeStreamEventState(previous, nextState) {
  if (!previous || !nextState) return previous;
  return {
    ...previous,
    event: nextState.event,
    competition: nextState.competition,
    remainingSeconds: nextState.remainingSeconds,
    now: nextState.now
  };
}

export default function PuzzlePage() {
  const { team, logout } = useAuth();
  const apiBase = getApiBaseUrl();
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
  const [navigation, setNavigation] = useState({ currentPuzzleId: null, currentPuzzleIndex: 0, totalPuzzles: 0, canAdvance: false, canSkip: false, isStarted: false, isFinished: false });
  const [isFullscreen, setIsFullscreen] = useState(() => typeof document !== "undefined" ? Boolean(document.fullscreenElement) : false);
  const [answerPopup, setAnswerPopup] = useState({ open: false, title: "", message: "", tone: "neutral" });
  const [showHints, setShowHints] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);
  const [toolsCollapsed, setToolsCollapsed] = useState(true);
  const antiCheatCooldownRef = useRef({ tab_out: 0, window_blur: 0 });
  const externalBypassUntilRef = useRef(0);
  const lastRefreshCoreRef = useRef(0);
  const previousStartedRef = useRef(false);

  const enforcement = eventState?.enforcement;
  const isLocked = Boolean(enforcement?.isLocked);
  const isBanned = Boolean(enforcement?.isBanned);
  const lifelineActive = Boolean(enforcement?.lifelineActive);
  const lifelineRemainingSeconds = Number(enforcement?.lifelineRemainingSeconds || 0);
  const isRestricted = isLocked || isBanned;
  const warnings = Number(enforcement?.warnings || 0);
  const maxWarnings = Number(enforcement?.maxWarnings || 3);
  const isStarted = Boolean(eventState?.event?.isStarted && navigation.isStarted);
  const isTimeUp = Boolean(eventState?.competition?.isTimeUp);
  const isFinished = Boolean(navigation.isFinished);
  const currentPuzzleId = navigation.currentPuzzleId || "";
  const isInputDisabled = isRestricted || isTimeUp || !isStarted || isFinished || !currentPuzzleId;

  const refreshCore = useCallback(async () => {
    const now = Date.now();
    if (now - lastRefreshCoreRef.current < 2000) return;
    lastRefreshCoreRef.current = now;
    const parsedEvent = EventStateResponseSchema.parse((await api.get("/event/state")).data);
    setEventState(parsedEvent);
    if (parsedEvent.enforcement?.isLocked || parsedEvent.enforcement?.isBanned || !parsedEvent.event?.isStarted) {
      setProgress([]);
      setPuzzles([]);
      setClipboardEntries([]);
      setAssetItems([]);
      setSelectedPuzzleId("");
      setPuzzleDetail(null);
      setNavigation({ currentPuzzleId: null, currentPuzzleIndex: 0, totalPuzzles: 0, canAdvance: false, canSkip: false, isStarted: Boolean(parsedEvent.event?.isStarted), isFinished: false });
      return;
    }

    const [progressRes, puzzlesRes, clipboardRes] = await Promise.all([api.get("/progress"), api.get("/puzzles"), api.get("/clipboard")]);
    const parsedProgress = ProgressResponseSchema.parse(progressRes.data);
    const parsedPuzzles = PuzzleListResponseSchema.parse(puzzlesRes.data);
    const parsedClipboard = ClipboardResponseSchema.parse(clipboardRes.data);
    setProgress(parsedProgress.items);
    setPuzzles(parsedPuzzles.puzzles);
    setClipboardEntries(parsedClipboard.entries);
    setNavigation({
      currentPuzzleId: parsedPuzzles.currentPuzzleId,
      currentPuzzleIndex: parsedPuzzles.currentPuzzleIndex,
      totalPuzzles: parsedPuzzles.totalPuzzles,
      canAdvance: parsedPuzzles.canAdvance,
      canSkip: parsedPuzzles.canSkip,
      isStarted: parsedPuzzles.isStarted,
      isFinished: parsedPuzzles.isFinished
    });
    if (!parsedPuzzles.currentPuzzleId) {
      setSelectedPuzzleId("");
      setPuzzleDetail(null);
      setAssetItems([]);
      return;
    }
    setSelectedPuzzleId(parsedPuzzles.currentPuzzleId);
  }, []);

  const refreshPuzzleDetail = useCallback(async () => {
    if (!selectedPuzzleId) {
      setAssetItems([]);
      setPuzzleDetail(null);
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
      setPuzzleDetail(parsedDetail.puzzle);
      setNotepad(parsedNotepad.content);
      setAssetItems(Array.isArray(assetsRes.data?.items) ? assetsRes.data.items : []);
      setNavigation((previous) => ({
        ...previous,
        canAdvance: Boolean(parsedDetail.puzzle.progress?.canAdvance),
        canSkip: Boolean(parsedDetail.puzzle.progress?.canSkip)
      }));
    } catch (requestError) {
      setPuzzleDetail(null);
      setAssetItems([]);
      setFeedback(requestError?.response?.data?.message || "Unable to load puzzle details.");
      if (requestError?.response?.status === 403) await refreshCore();
    }
  }, [refreshCore, selectedPuzzleId]);
  const reportViolation = useCallback(async (type, detail) => {
    if (isRestricted || lifelineActive || !selectedPuzzleId) return;
    const now = Date.now();
    if (now < externalBypassUntilRef.current) return;
    if (now - (antiCheatCooldownRef.current[type] || 0) < 2500) return;
    antiCheatCooldownRef.current[type] = now;
    try {
      const response = await api.post("/anti-cheat/violation", { type, detail, puzzleId: selectedPuzzleId });
      if (response?.data?.message) setFeedback(response.data.message);
    } catch (requestError) {
      setFeedback(requestError?.response?.data?.message || "Unable to report warning.");
    }
  }, [isRestricted, lifelineActive, selectedPuzzleId]);

  const activateLifeline = async () => {
    if (!selectedPuzzleId || isInputDisabled) {
      setFeedback("Select the active puzzle before activating lifeline.");
      return;
    }
    try {
      const response = await api.post("/lifeline/activate", { puzzleId: selectedPuzzleId });
      setFeedback(response?.data?.message || "Lifeline activated.");
      await refreshCore();
      await refreshPuzzleDetail();
    } catch (requestError) {
      setFeedback(requestError?.response?.data?.message || "Unable to activate lifeline.");
    }
  };

  const boot = useCallback(async () => {
    try {
      await refreshCore();
      setError("");
    } catch (requestError) {
      if (requestError?.response?.status === 401) await logout();
      setError(requestError?.response?.data?.message || "Unable to load event state.");
    } finally {
      setLoading(false);
    }
  }, [logout, refreshCore]);

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    if (selectedPuzzleId) refreshPuzzleDetail();
  }, [refreshPuzzleDetail, selectedPuzzleId]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    const source = new EventSource(`${apiBase}/events/stream`, { withCredentials: false });
    const handleSnapshot = async (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (!parsed?.eventState) return;
        setEventState((previous) => mergeStreamEventState(previous, parsed.eventState));
        const nextStarted = Boolean(parsed.eventState?.event?.isStarted);
        if (nextStarted !== previousStartedRef.current) {
          previousStartedRef.current = nextStarted;
          await refreshCore();
        }
      } catch {
        // Ignore malformed frames.
      }
    };
    source.addEventListener("snapshot", (event) => {
      handleSnapshot(event).catch(() => {});
    });
    source.onerror = () => {
      setTimeout(() => { try { source.close(); } catch {} }, Math.random() * 3000 + 1000);
    };
    return () => source.close();
  }, [apiBase, refreshCore]);

  useEffect(() => {
    if (isRestricted) return undefined;
    const onVisibility = () => {
      if (document.hidden) reportViolation("tab_out", "Document hidden/tab switched.");
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
    if (!selectedPuzzleId || isInputDisabled) return;
    const timeout = setTimeout(() => {
      api.post(`/puzzles/${selectedPuzzleId}/notepad`, { content: notepad }).then((response) => NotepadResponseSchema.parse(response.data)).catch(() => {});
    }, 2000);
    return () => clearTimeout(timeout);
  }, [isInputDisabled, notepad, selectedPuzzleId]);

  const submitAnswer = async () => {
    if (isInputDisabled) {
      setFeedback(isTimeUp ? "Time is up for this event." : "Answer submission is currently disabled.");
      setShowConfirm(false);
      return;
    }
    try {
      const parsed = PuzzleSubmitResponseSchema.parse((await api.post(`/puzzles/${selectedPuzzleId}/submit`, { answer })).data);
      setFeedback(parsed.message);
      setAnswerPopup({ open: true, title: parsed.result === "correct" ? "Correct Answer" : "Incorrect Answer", message: parsed.message, tone: parsed.result === "correct" ? "success" : "error" });
      setShowConfirm(false);
      setAnswer("");
      await refreshCore();
      await refreshPuzzleDetail();
    } catch (requestError) {
      const message = requestError?.response?.data?.message || "Submit failed";
      setFeedback(message);
      setAnswerPopup({ open: true, title: "Submission Failed", message, tone: "error" });
      setShowConfirm(false);
    }
  };

  const advanceToNextPuzzle = async () => {
    if (!navigation.canAdvance || isInputDisabled) return;
    try {
      const response = await api.post("/puzzles/current/advance");
      setFeedback(response?.data?.message || "Advanced to the next puzzle.");
      setAnswer("");
      await refreshCore();
      await refreshPuzzleDetail();
    } catch (requestError) {
      setFeedback(requestError?.response?.data?.message || "Unable to advance to the next puzzle.");
    }
  };

  const skipCurrentPuzzle = async () => {
    if (!navigation.canSkip || isInputDisabled) {
      setShowSkipConfirm(false);
      return;
    }
    try {
      const response = await api.post("/puzzles/current/skip");
      setFeedback(response?.data?.message || "Current puzzle skipped.");
      setShowSkipConfirm(false);
      setAnswer("");
      await refreshCore();
      await refreshPuzzleDetail();
    } catch (requestError) {
      setFeedback(requestError?.response?.data?.message || "Unable to skip the current puzzle.");
      setShowSkipConfirm(false);
    }
  };

  const revealHint = async (tier) => {
    if (isInputDisabled) {
      setFeedback(isTimeUp ? "Time is up for this event." : "Hints are currently disabled.");
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

  const pushClipboard = async (value, source = "manual") => {
    if (!value || isInputDisabled) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {}
    try {
      const parsed = ClipboardResponseSchema.parse((await api.post("/clipboard", { value, source })).data);
      setClipboardEntries(parsed.entries);
    } catch {}
  };
  const selectedPuzzle = useMemo(() => puzzles.find((item) => item.id === selectedPuzzleId) || null, [puzzles, selectedPuzzleId]);
  const shouldShowInterpreter = useMemo(() => {
    if (!puzzleDetail) return false;
    const type = `${puzzleDetail.type || ""}`.toLowerCase();
    if (type === "fix_the_bug") return false;
    const builtins = puzzleDetail?.toolConfig?.builtinUtils || [];
    if (builtins.includes("codeWorkspace") || builtins.includes("pythonInterpreter") || builtins.includes("codeVerifier")) return true;
    if (["fix_errors", "code", "programming", "scripting"].includes(type)) return true;
    return assetItems.some((item) => `${item.name || ""}`.toLowerCase().endsWith(".py"));
  }, [assetItems, puzzleDetail]);

  const resolveExternalUrl = (rawUrl) => {
    const value = `${rawUrl || ""}`.trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    return `${apiBase}${value.startsWith("/") ? value : `/${value}`}`;
  };

  const launchExternal = (link) => {
    const resolvedUrl = resolveExternalUrl(link?.url);
    if (!resolvedUrl) return;
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
    if (!primary?.url) return;
    externalBypassUntilRef.current = Date.now() + 20000;
    launchExternal(primary);
  };

  const handleExternalLaunch = (link) => {
    if (!link?.url) return;
    externalBypassUntilRef.current = Date.now() + 20000;
    launchExternal(link);
  };

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setFeedback("Exited fullscreen mode.");
      } else {
        await document.documentElement.requestFullscreen();
        setFeedback("Fullscreen mode enabled.");
      }
    } catch {
      setFeedback("Fullscreen request was blocked by the browser.");
    }
  };

  const hasConfiguredTools = Boolean(puzzleDetail?.toolConfig?.builtinUtils?.length) || Boolean(puzzleDetail?.toolConfig?.externalLinks?.length);

  if (loading) return <main className="flex min-h-screen items-center justify-center bg-bg text-fg"><p>Loading event workspace...</p></main>;

  return (
    <main className="min-h-screen bg-bg pb-16 pt-14 text-fg">
      <TimerBar remainingSeconds={eventState?.remainingSeconds || 0} isPaused={Boolean(eventState?.competition?.isPaused)} isTimeUp={isTimeUp} />
      <div className="mx-auto max-w-7xl px-4 py-5 md:px-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-700/40 bg-card p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Team Session</p>
            <h1 className="font-display text-2xl">{team?.name}</h1>
            <p className="text-xs text-muted">Puzzle {Math.min(navigation.currentPuzzleIndex + 1, Math.max(navigation.totalPuzzles, 1))} of {navigation.totalPuzzles || 0}</p>
          </div>
          <div className="flex items-center gap-2">
            <DarkModeToggle />
            <button type="button" className="rounded-xl border border-slate-500 px-3 py-2 text-sm" onClick={toggleFullscreen}>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</button>
            <button type="button" className="rounded-xl border border-slate-500 px-3 py-2 text-sm" onClick={logout}>Logout</button>
          </div>
        </header>

        {error ? <p className="mb-3 rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p> : null}
        {feedback ? <p className="mb-3 rounded-lg bg-sky-950/40 p-3 text-sm text-sky-200">{feedback}</p> : null}
        <p className={`mb-3 rounded-lg p-3 text-sm ${isRestricted ? "bg-red-950/40 text-red-300" : "bg-amber-950/30 text-amber-200"}`}>
          Anti-cheat warnings: {warnings}/{maxWarnings}
          {isBanned ? " - Team is banned by admin." : lifelineActive ? " - Lifeline active. Anti-cheat is bypassed for this puzzle." : isLocked ? " - Team is locked for this event." : " - Tab switching/window blur issues warnings."}
        </p>

        {!isStarted ? <section className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-6 text-center"><h2 className="font-display text-2xl text-cyan-100">Waiting For Event Start</h2><p className="mt-2 text-sm text-cyan-100/80">Your team is registered. The puzzle set and timer will appear here as soon as the admin starts the event.</p></section> : null}
        {isStarted ? (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={activateLifeline} disabled={isInputDisabled || lifelineActive || enforcement?.lifelinesRemaining <= 0} className="rounded-lg border border-cyan-400/70 px-3 py-2 text-sm disabled:opacity-50">{lifelineActive ? "Lifeline Active" : `Use Lifeline (${enforcement?.lifelinesRemaining || 0} remaining)`}</button>
              <p className="text-xs text-muted">Lifeline disables anti-cheat and ends immediately when you switch or complete puzzles.</p>
            </div>

            <ProgressTracker items={progress} selectedPuzzleId={selectedPuzzleId} enabledPuzzleIds={currentPuzzleId ? [currentPuzzleId] : []} onSelect={() => {}} />
            {isTimeUp ? <section className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5 text-rose-100"><h2 className="font-display text-2xl">Time&apos;s Up</h2><p className="mt-2 text-sm text-rose-100/80">The countdown has ended. Answer entry and puzzle progression are now locked for all teams.</p></section> : null}
            {isFinished ? <section className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 text-emerald-100"><h2 className="font-display text-2xl">All Assigned Puzzles Completed</h2><p className="mt-2 text-sm text-emerald-100/80">Your team has reached the end of its assigned puzzle order.</p></section> : null}

            <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
              <section className="space-y-4">
                <article className="rounded-2xl border border-slate-700/40 bg-card p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.2em] text-muted">Current Puzzle</p>
                      <h2 className="font-display text-2xl">{selectedPuzzle?.title || "Waiting for puzzle"}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" className="rounded-lg border border-amber-400/70 px-3 py-2 text-sm" onClick={() => setShowHints(true)} disabled={!puzzleDetail || isInputDisabled}>Hints</button>
                      {puzzleDetail?.progress?.canAdvance ? <button type="button" className="rounded-lg border border-emerald-400/70 px-3 py-2 text-sm disabled:opacity-50" onClick={advanceToNextPuzzle} disabled={isInputDisabled}>Next Puzzle</button> : null}
                      {puzzleDetail?.progress?.canSkip ? <button type="button" className="rounded-lg border border-rose-400/70 px-3 py-2 text-sm text-rose-100 disabled:opacity-50" onClick={() => setShowSkipConfirm(true)} disabled={isInputDisabled}>Skip Puzzle</button> : null}
                      {puzzleDetail?.toolConfig?.isInspectPuzzle ? <button type="button" onClick={openChallengePage} className="rounded-lg border border-sky-400/70 px-3 py-2 text-sm" disabled={isInputDisabled}>Open Challenge Page</button> : null}
                      {puzzleDetail?.toolConfig?.externalLinks?.length ? <button type="button" onClick={openPrimaryExternalTool} className="rounded-lg border border-emerald-400/70 px-3 py-2 text-sm" disabled={isInputDisabled}>Open External Tool</button> : null}
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-slate-100">{puzzleDetail?.prompt || "Puzzle content will appear here."}</p>
                </article>
                <section className="rounded-2xl border border-slate-700/40 bg-card p-5">
                  <h3 className="mb-2 font-semibold">Puzzle Files</h3>
                  {assetItems.length === 0 ? <p className="text-sm text-muted">No files attached to this puzzle.</p> : <div className="space-y-3">{assetItems.map((item) => { const href = `${apiBase}${item.url}`; return <article key={item.relativePath} className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-100">{item.name}</p><p className="text-xs text-muted">{item.relativePath}</p></div><a href={href} target="_blank" rel="noreferrer" onClick={() => { externalBypassUntilRef.current = Date.now() + 20000; }} className="rounded-md border border-slate-500 px-3 py-1 text-xs text-sky-300">Open File</a></div>{item.mediaType === "audio" ? <audio className="mt-3 w-full" controls src={href} preload="metadata" /> : null}</article>; })}</div>}
                </section>

                <section className="rounded-2xl border border-slate-700/40 bg-card p-5">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold">Tools</h3>
                    {hasConfiguredTools ? <button type="button" className="rounded-md border border-slate-500 px-3 py-1 text-sm" onClick={() => setToolsCollapsed((value) => !value)}>{toolsCollapsed ? "Expand" : "Collapse"}</button> : null}
                  </div>
                  {!hasConfiguredTools ? <p className="text-sm text-muted">No in-platform tools are required for this puzzle.</p> : null}
                  {isInputDisabled ? <p className="text-sm text-red-300">Tools are disabled while this puzzle is inactive.</p> : null}
                  {toolsCollapsed || !puzzleDetail || !hasConfiguredTools || isInputDisabled ? null : <ToolsPanel toolConfig={puzzleDetail.toolConfig} onCopy={(value, source) => pushClipboard(value, source)} onExternalLaunch={handleExternalLaunch} />}
                </section>

                {shouldShowInterpreter ? <CodeInterpreterPanel puzzleId={selectedPuzzleId} puzzleType={puzzleDetail?.type} toolConfig={puzzleDetail?.toolConfig} assetItems={assetItems} disabled={isInputDisabled || !selectedPuzzleId} onCheckSuccess={async () => { await refreshCore(); await refreshPuzzleDetail(); }} /> : null}

                {!shouldShowInterpreter ? (() => {
                  const isFixTheBug = `${puzzleDetail?.type || ""}`.toLowerCase() === "fix_the_bug";

                  if (isFixTheBug) {
                    return (
                      <>
                        {/* Download buggy code files */}
                        {assetItems.length > 0 ? (
                          <section className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5">
                            <h3 className="mb-2 font-semibold text-amber-200">🐛 Buggy Code Files</h3>
                            <p className="mb-3 text-sm text-amber-100/70">Download the file(s) below, find and fix the bug, then run the corrected code.</p>
                            <div className="flex flex-wrap gap-2">
                              {assetItems.map((item) => {
                                const href = `${apiBase}${item.url}`;
                                const downloadFile = async (e) => {
                                  e.preventDefault();
                                  externalBypassUntilRef.current = Date.now() + 20000;
                                  try {
                                    const res = await fetch(href, { credentials: "include" });
                                    const blob = await res.blob();
                                    const url = URL.createObjectURL(blob);
                                    const a = document.createElement("a");
                                    a.href = url;
                                    a.download = item.name || "download.py";
                                    document.body.appendChild(a);
                                    a.click();
                                    a.remove();
                                    URL.revokeObjectURL(url);
                                  } catch { setFeedback("Download failed."); }
                                };
                                return (
                                  <button type="button" key={item.relativePath} onClick={downloadFile} className="inline-flex items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-950/40 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-900/50">
                                    ⬇ Download {item.name}
                                  </button>
                                );
                              })}
                            </div>
                          </section>
                        ) : null}

                        {/* Run your code button */}
                        <section className="rounded-2xl border border-violet-500/30 bg-violet-950/20 p-5">
                          <h3 className="mb-2 font-semibold text-violet-200">▶ Run Your Code</h3>
                          <p className="mb-3 text-sm text-violet-100/70">Open the online Python compiler to test your fixed code. Copy the output and paste it below.</p>
                          <button type="button" onClick={() => { externalBypassUntilRef.current = Date.now() + 20000; window.open("https://www.programiz.com/python-programming/online-compiler/", "_blank", "noopener,noreferrer"); }} className="rounded-lg border border-violet-400/60 bg-violet-950/40 px-4 py-2 text-sm font-semibold text-violet-100 transition hover:bg-violet-900/50" disabled={isInputDisabled}>
                            🖥 Open Online Compiler
                          </button>
                        </section>

                        {/* Answer submission — multiline textarea */}
                        <section className="rounded-2xl border border-slate-700/40 bg-card p-5">
                          <h3 className="mb-2 font-semibold">Answer Submission</h3>
                          <label className="mb-1 block text-sm text-muted" htmlFor="fix-bug-answer">Paste your output here</label>
                          <textarea id="fix-bug-answer" className="h-32 w-full rounded-xl border border-slate-600 bg-slate-950/70 p-3 font-mono text-sm" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Paste all lines of output here..." disabled={isInputDisabled} spellCheck={false} />
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button type="button" className="rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950 disabled:opacity-50" onClick={() => setShowConfirm(true)} disabled={!answer.trim() || isInputDisabled}>Submit Answer</button>
                            {puzzleDetail?.progress?.canAdvance ? <button type="button" className="rounded-xl border border-emerald-400/70 px-4 py-2 font-semibold text-emerald-100 disabled:opacity-50" onClick={advanceToNextPuzzle} disabled={isInputDisabled}>Next Puzzle</button> : null}
                            {puzzleDetail?.progress?.canSkip ? <button type="button" className="rounded-xl border border-rose-400/70 px-4 py-2 font-semibold text-rose-100 disabled:opacity-50" onClick={() => setShowSkipConfirm(true)} disabled={isInputDisabled}>Skip Puzzle</button> : null}
                          </div>
                        </section>
                      </>
                    );
                  }

                  return (
                  <section className="rounded-2xl border border-slate-700/40 bg-card p-5">
                    <h3 className="mb-2 font-semibold">Answer Submission</h3>
                    <textarea className="h-24 w-full rounded-xl border border-slate-600 bg-slate-950/70 p-3 uppercase" value={answer} onChange={(event) => setAnswer(event.target.value.toUpperCase())} placeholder="Enter final answer" disabled={isInputDisabled} autoCapitalize="characters" spellCheck={false} />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button type="button" className="rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950 disabled:opacity-50" onClick={() => setShowConfirm(true)} disabled={!answer.trim() || isInputDisabled}>Submit Answer</button>
                      {puzzleDetail?.progress?.canAdvance ? <button type="button" className="rounded-xl border border-emerald-400/70 px-4 py-2 font-semibold text-emerald-100 disabled:opacity-50" onClick={advanceToNextPuzzle} disabled={isInputDisabled}>Next Puzzle</button> : null}
                      {puzzleDetail?.progress?.canSkip ? <button type="button" className="rounded-xl border border-rose-400/70 px-4 py-2 font-semibold text-rose-100 disabled:opacity-50" onClick={() => setShowSkipConfirm(true)} disabled={isInputDisabled}>Skip Puzzle</button> : null}
                    </div>
                  </section>
                  );
                })() : null}
              </section>

              <aside className="space-y-4">
                <section className="rounded-2xl border border-slate-700/40 bg-card p-4">
                  <h3 className="mb-2 font-semibold">Scratch Notepad</h3>
                  <p className="mb-2 text-xs text-muted">Autosaves after 500ms for the active puzzle.</p>
                  <textarea className="h-72 w-full rounded-xl border border-slate-600 bg-slate-950/70 p-3 font-mono text-sm" value={notepad} onChange={(event) => setNotepad(event.target.value)} disabled={isInputDisabled} />
                </section>
                <ClipboardTray entries={clipboardEntries} />
              </aside>
            </div>
          </>
        ) : null}
      </div>

      <HintModal open={showHints} hints={puzzleDetail?.hints || []} onClose={() => setShowHints(false)} onReveal={revealHint} />
      <ConfirmModal open={showConfirm} title="Confirm Submission" body="Submit this answer now? This action records an attempt on the current puzzle." onConfirm={submitAnswer} onCancel={() => setShowConfirm(false)} />
      <ConfirmModal open={showSkipConfirm} title="Skip Current Puzzle" body="Skip this puzzle and move on? You will not be able to come back to this puzzle later." onConfirm={skipCurrentPuzzle} onCancel={() => setShowSkipConfirm(false)} />

      {answerPopup.open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-600 bg-slate-950 p-5">
            <h3 className={`text-lg font-semibold ${answerPopup.tone === "success" ? "text-emerald-300" : answerPopup.tone === "error" ? "text-rose-300" : ""}`}>{answerPopup.title}</h3>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{answerPopup.message}</p>
            <div className="mt-5 flex items-center justify-end gap-2"><button type="button" className="rounded-md bg-accent px-3 py-1 font-semibold text-slate-950" onClick={() => setAnswerPopup({ open: false, title: "", message: "", tone: "neutral" })}>OK</button></div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
