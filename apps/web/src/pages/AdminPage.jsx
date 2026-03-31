import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

const BUILTIN_UTILS = [
  "cipherDecoder",
  "baseConverter",
  "encodingChain",
  "frequencyAnalyzer",
  "hashCalculator",
  "subnetCalculator",
  "bitwiseCalculator",
  "hexViewer",
  "codeWorkspace",
  "pythonInterpreter",
  "codeVerifier"
];

const UPLOAD_ACCEPT_LIST = ".txt,.md,.pdf,.json,.yaml,.yml,.xml,.csv,.html,.js,.css,.py,.zip,.wav,.mp3,.ogg,.m4a,.mp4,.png,.jpg,.jpeg,.gif,.webp,.bin";

const PUZZLE_BASE_CONFIGS = {
  custom: {
    key: "custom",
    label: "Custom (Manual)"
  },
  imageCipher: {
    key: "imageCipher",
    label: "Image Cipher",
    slugPrefix: "image-cipher",
    titlePrefix: "Image Cipher",
    type: "image_cipher",
    prompt:
      "Analyze the uploaded image files. Extract the hidden pattern or encoded value and submit the final decoded answer.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["hexViewer", "frequencyAnalyzer"],
    hints: {
      tier1: { content: "Inspect pixel blocks and color channels first.", penaltySeconds: 0 },
      tier2: { content: "Check for repeating offsets or steganographic patterns.", penaltySeconds: 1 },
      tier3: { content: "Try extracting metadata and compare with visible artifacts.", penaltySeconds: 2 }
    },
    readmeFileName: "README_IMAGE_CIPHER.txt",
    readmeContent:
      "IMAGE CIPHER BASE INSTRUCTIONS\n\n1. Download the provided image file(s).\n2. Inspect metadata and pixel/channel-level anomalies.\n3. Decode the hidden payload or pattern.\n4. Submit the final decoded value in uppercase with no spaces unless the puzzle prompt says otherwise."
  },
  htmlInspect: {
    key: "htmlInspect",
    label: "HTML Inspect",
    slugPrefix: "html-inspect",
    titlePrefix: "HTML Inspect",
    type: "html_inspect",
    prompt:
      "Inspect the challenge HTML/DOM source and hidden comments to extract the final keyword.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["hexViewer", "encodingChain"],
    isInspectPuzzle: true,
    isolatedUrl: "/challenge/SET_SLUG",
    hints: {
      tier1: { content: "Check HTML comments and hidden elements first.", penaltySeconds: 0 },
      tier2: { content: "Inspect script tags and data-* attributes for encoded clues.", penaltySeconds: 1 },
      tier3: { content: "Verify exact casing/spacing in the recovered keyword.", penaltySeconds: 2 }
    },
    readmeFileName: "README_HTML_INSPECT.txt",
    readmeContent:
      "HTML INSPECT BASE INSTRUCTIONS\n\n1. Open the challenge page in browser and inspect source/DOM.\n2. Locate hidden comments/attributes/scripts with clues.\n3. Decode any embedded encoded fragments.\n4. Submit the final keyword exactly." 
  },
  asciiArt: {
    key: "asciiArt",
    label: "ASCII Art Puzzle",
    slugPrefix: "ascii-art",
    titlePrefix: "ASCII Art Puzzle",
    type: "ascii_numeric",
    prompt:
      "Decode ASCII/character-based puzzle text to recover the final answer.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["baseConverter", "encodingChain", "hexViewer"],
    hints: {
      tier1: { content: "Map symbols to ASCII values systematically.", penaltySeconds: 0 },
      tier2: { content: "Check decimal/hex/binary interpretation paths.", penaltySeconds: 1 },
      tier3: { content: "Reconstruct output in the exact requested format.", penaltySeconds: 2 }
    },
    readmeFileName: "README_ASCII_ART.txt",
    readmeContent:
      "ASCII ART BASE INSTRUCTIONS\n\n1. Open the puzzle text files.\n2. Convert encoded character patterns using ASCII/base tools.\n3. Reassemble decoded fragments in order.\n4. Submit the final output exactly." 
  },
  audioMorse: {
    key: "audioMorse",
    label: "Audio Morse",
    slugPrefix: "audio-morse",
    titlePrefix: "Audio Morse",
    type: "audio_morse",
    prompt:
      "Analyze the uploaded audio signal, extract the Morse sequence, decode it, and submit the final text answer.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["encodingChain", "frequencyAnalyzer"],
    hints: {
      tier1: { content: "Visualize waveform timing first.", penaltySeconds: 0 },
      tier2: { content: "Map short/long beeps to dot/dash sequences.", penaltySeconds: 1 },
      tier3: { content: "Group Morse by character spacing before decoding.", penaltySeconds: 2 }
    },
    readmeFileName: "README_AUDIO_MORSE.txt",
    readmeContent:
      "AUDIO MORSE BASE INSTRUCTIONS\n\n1. Listen to the provided audio file(s).\n2. Convert beep timing into dot/dash Morse symbols.\n3. Decode Morse into text.\n4. Submit the decoded message in uppercase unless prompt specifies otherwise."
  },
  progressiveCaesar: {
    key: "progressiveCaesar",
    label: "Progressive Caesar Cipher",
    slugPrefix: "progressive-caesar",
    titlePrefix: "Progressive Caesar Cipher",
    type: "caesar",
    prompt:
      "Decrypt progressive Caesar ciphertext where shift changes per character position.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["cipherDecoder", "frequencyAnalyzer"],
    hints: {
      tier1: { content: "Identify the shift progression rule first.", penaltySeconds: 0 },
      tier2: { content: "Test with short prefixes and verify word boundaries.", penaltySeconds: 1 },
      tier3: { content: "Normalize punctuation/case according to prompt rules.", penaltySeconds: 2 }
    },
    readmeFileName: "README_PROGRESSIVE_CAESAR.txt",
    readmeContent:
      "PROGRESSIVE CAESAR BASE INSTRUCTIONS\n\n1. Determine base shift and progression logic.\n2. Decrypt message character-by-character.\n3. Validate plaintext plausibility.\n4. Submit final phrase exactly as required." 
  },
  timeBasedOtpVisual: {
    key: "timeBasedOtpVisual",
    label: "Time-Based OTP (Visual)",
    slugPrefix: "time-based-otp",
    titlePrefix: "Time-Based OTP",
    type: "otp",
    prompt:
      "Use visual/dial clues and OTP puzzle artifacts to reconstruct the final answer token.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["hashCalculator", "baseConverter"],
    hints: {
      tier1: { content: "Map each dial/clock indicator to candidate symbols.", penaltySeconds: 0 },
      tier2: { content: "Validate sequence order and time-step assumptions.", penaltySeconds: 1 },
      tier3: { content: "Confirm final token formatting before submit.", penaltySeconds: 2 }
    },
    readmeFileName: "README_TIME_BASED_OTP.txt",
    readmeContent:
      "TIME-BASED OTP BASE INSTRUCTIONS\n\n1. Inspect visual clue assets carefully.\n2. Translate each indicator to symbols based on puzzle spec.\n3. Assemble OTP output in correct order.\n4. Submit final token exactly." 
  },
  bookCipher: {
    key: "bookCipher",
    label: "Book Cipher",
    slugPrefix: "book-cipher",
    titlePrefix: "Book Cipher",
    type: "book_cipher",
    prompt:
      "Use the uploaded reference text and coordinate list to decode the hidden message, then submit the final answer.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["baseConverter", "hexViewer"],
    hints: {
      tier1: { content: "Confirm coordinate format (page/line/word or line/word/char).", penaltySeconds: 0 },
      tier2: { content: "Extract values in order without skipping separators.", penaltySeconds: 1 },
      tier3: { content: "Re-check indexing (1-based vs 0-based) if decode looks shifted.", penaltySeconds: 2 }
    },
    readmeFileName: "README_BOOK_CIPHER.txt",
    readmeContent:
      "BOOK CIPHER BASE INSTRUCTIONS\n\n1. Open the reference text file and coordinate file.\n2. Resolve each coordinate in sequence.\n3. Assemble decoded characters/words in order.\n4. Submit the final reconstructed phrase."
  },
  reverseText: {
    key: "reverseText",
    label: "Reverse Text Puzzle",
    slugPrefix: "reverse-text",
    titlePrefix: "Reverse Text Puzzle",
    type: "reverse",
    prompt:
      "Reverse and reconstruct each clue segment to reveal the final answer phrase.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["encodingChain", "hexViewer"],
    hints: {
      tier1: { content: "Reverse each line independently before combining.", penaltySeconds: 0 },
      tier2: { content: "Watch for delimiters/spaces that shift after reverse.", penaltySeconds: 1 },
      tier3: { content: "Ensure final concatenation matches prompt format.", penaltySeconds: 2 }
    },
    readmeFileName: "README_REVERSE_TEXT.txt",
    readmeContent:
      "REVERSE TEXT BASE INSTRUCTIONS\n\n1. Reverse provided lines/chunks.\n2. Normalize spacing and separators.\n3. Reassemble final phrase/code.\n4. Submit exactly as required." 
  },
  fixErrors: {
    key: "fixErrors",
    label: "Fix Errors",
    slugPrefix: "fix-errors",
    titlePrefix: "Fix Errors",
    type: "fix_errors",
    prompt:
      "Review the uploaded buggy script, identify and fix the issues, then submit the required output or corrected flag.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["codeWorkspace", "pythonInterpreter", "codeVerifier"],
    hints: {
      tier1: { content: "Run through imports, syntax, and variable naming first.", penaltySeconds: 0 },
      tier2: { content: "Trace logic branches and off-by-one boundaries.", penaltySeconds: 1 },
      tier3: { content: "Validate final output format exactly as requested.", penaltySeconds: 2 }
    },
    readmeFileName: "README_FIX_ERRORS.txt",
    readmeContent:
      "FIX ERRORS BASE INSTRUCTIONS\n\n1. Open the provided buggy code file(s).\n2. Fix syntax/runtime/logic errors.\n3. Run and verify expected output.\n4. Submit the required final answer in the format specified by the puzzle prompt."
  },
  printStatementMaze: {
    key: "printStatementMaze",
    label: "Print Statement Maze",
    slugPrefix: "print-statement-maze",
    titlePrefix: "Print Statement Maze",
    type: "maze",
    prompt:
      "Follow print-statement/step trace clues to find the valid maze route output.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["encodingChain", "baseConverter"],
    hints: {
      tier1: { content: "Trace route state line-by-line first.", penaltySeconds: 0 },
      tier2: { content: "Mark invalid branches and backtracking points.", penaltySeconds: 1 },
      tier3: { content: "Validate full move sequence against constraints.", penaltySeconds: 2 }
    },
    readmeFileName: "README_PRINT_STATEMENT_MAZE.txt",
    readmeContent:
      "PRINT STATEMENT MAZE BASE INSTRUCTIONS\n\n1. Follow the trace/print outputs carefully.\n2. Build the valid route sequence step-by-step.\n3. Eliminate paths that violate maze constraints.\n4. Submit final move sequence exactly." 
  },
  fixTheBug: {
    key: "fixTheBug",
    label: "Fix the Bug",
    slugPrefix: "fix-the-bug",
    titlePrefix: "Fix the Bug",
    type: "fix_the_bug",
    prompt:
      "Download the buggy Python code below, find and fix the bug(s), run the corrected code in the online compiler, and paste the exact program output as your answer.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: [],
    hints: {
      tier1: { content: "Read the code line by line \u2014 the bug is in the logic, not just syntax.", penaltySeconds: 0 },
      tier2: { content: "Pay attention to loop boundaries and variable assignments.", penaltySeconds: 1 },
      tier3: { content: "Run the original code first to see what the wrong output looks like, then compare.", penaltySeconds: 2 }
    },
    readmeFileName: "README_FIX_THE_BUG.txt",
    readmeContent:
      "FIX THE BUG BASE INSTRUCTIONS\n\n1. Download the attached buggy Python code file.\n2. Read the code and identify the bug(s).\n3. Fix the code and run it using the online compiler (Programiz).\n4. Copy the exact output and paste it into the answer field.\n5. Submit your answer."
  },
  patternDecode: {
    key: "patternDecode",
    label: "Pattern Decode",
    slugPrefix: "pattern-decode",
    titlePrefix: "Pattern Decode",
    type: "pattern_decode",
    prompt:
      "Analyze the provided pattern sequence, identify the encoding rule, and decode the hidden message. Submit the final decoded answer.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["encodingChain", "baseConverter", "frequencyAnalyzer"],
    hints: {
      tier1: { content: "Look for repeating sequences or numerical progressions in the pattern.", penaltySeconds: 0 },
      tier2: { content: "Try mapping symbols to letters using positional or mathematical relationships.", penaltySeconds: 1 },
      tier3: { content: "The decoded output should form a recognizable word or phrase.", penaltySeconds: 2 }
    },
    readmeFileName: "README_PATTERN_DECODE.txt",
    readmeContent:
      "PATTERN DECODE BASE INSTRUCTIONS\n\n1. Study the provided pattern or encoded sequence carefully.\n2. Identify the encoding rule or transformation applied.\n3. Apply the reverse transformation to decode the message.\n4. Submit the final decoded answer exactly as required."
  },
  storyPuzzle: {
    key: "storyPuzzle",
    label: "Story Puzzle",
    slugPrefix: "story-puzzle",
    titlePrefix: "Story Puzzle",
    type: "story_puzzle",
    prompt:
      "Read the story carefully, extract the hidden clues embedded within the narrative, and piece them together to form the final answer.",
    answerKeyPlaceholder: "SET_ME",
    hintPenaltySeconds: 0,
    builtinUtils: ["encodingChain", "cipherDecoder"],
    hints: {
      tier1: { content: "Pay close attention to capitalized words, first letters, or unusual phrasing.", penaltySeconds: 0 },
      tier2: { content: "The clues follow a specific order \u2014 read paragraphs sequentially.", penaltySeconds: 1 },
      tier3: { content: "Combine extracted letters or words to form the final answer.", penaltySeconds: 2 }
    },
    readmeFileName: "README_STORY_PUZZLE.txt",
    readmeContent:
      "STORY PUZZLE BASE INSTRUCTIONS\n\n1. Read the provided story or narrative text.\n2. Identify hidden clues within the text (acrostics, bold words, patterns, etc.).\n3. Extract and assemble the clues in order.\n4. Submit the final assembled answer."
  }
};

function createDefaultPuzzleDraft() {
  return {
    slug: "",
    title: "",
    type: "",
    prompt: "",
    answerKey: "",
    hintPenaltySeconds: 0,
    builtinUtils: [],
    externalLinksText: "[]",
    isInspectPuzzle: false,
    isolatedUrl: "",
    hints: {
      tier1: { content: "", penaltySeconds: 0 },
      tier2: { content: "", penaltySeconds: 1 },
      tier3: { content: "", penaltySeconds: 2 }
    }
  };
}

function parseExternalLinks(text) {
  const parsed = JSON.parse(text || "[]");
  if (!Array.isArray(parsed)) {
    throw new Error("External links must be a JSON array.");
  }

  for (const row of parsed) {
    if (!row || typeof row.label !== "string" || typeof row.url !== "string") {
      throw new Error("Each external link must include string label and url fields.");
    }

    if (
      row.openInNewTab !== undefined &&
      typeof row.openInNewTab !== "boolean"
    ) {
      throw new Error("openInNewTab must be a boolean when provided.");
    }

    if (
      row.bypassAntiCheat !== undefined &&
      typeof row.bypassAntiCheat !== "boolean"
    ) {
      throw new Error("bypassAntiCheat must be a boolean when provided.");
    }

    if (row.download !== undefined && typeof row.download !== "boolean") {
      throw new Error("download must be a boolean when provided.");
    }
  }

  return parsed;
}

function appendExternalLinkJson(text, nextLink) {
  const parsed = parseExternalLinks(text);
  parsed.push(nextLink);
  return JSON.stringify(parsed, null, 2);
}

function fileQueueKey(file) {
  return `${file.name}::${file.size}::${file.lastModified}`;
}

function mergeQueuedFiles(existingFiles, incomingFiles) {
  const merged = [...existingFiles];
  const seen = new Set(existingFiles.map((file) => fileQueueKey(file)));

  incomingFiles.forEach((file) => {
    const key = fileQueueKey(file);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(file);
  });

  return merged;
}

function buildTemplateSlug(prefix) {
  const safePrefix = `${prefix || "puzzle"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const nonce = Date.now().toString(36).slice(-6);
  return `${safePrefix || "puzzle"}-${nonce}`;
}

export default function AdminPage() {
  const { team, logout } = useAuth();

  const [section, setSection] = useState("config");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const [puzzles, setPuzzles] = useState([]);
  const [selectedPuzzleId, setSelectedPuzzleId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailAssets, setDetailAssets] = useState([]);

  const [builtinUtils, setBuiltinUtils] = useState([]);
  const [isInspectPuzzle, setIsInspectPuzzle] = useState(false);
  const [isolatedUrl, setIsolatedUrl] = useState("");
  const [externalLinksText, setExternalLinksText] = useState("[]");
  const [hintPenaltySeconds, setHintPenaltySeconds] = useState(0);
  const [hintDrafts, setHintDrafts] = useState({});

  const [teamMonitor, setTeamMonitor] = useState([]);
  const [leaderboardRows, setLeaderboardRows] = useState([]);
  const [sessionMonitor, setSessionMonitor] = useState([]);
  const [warningItems, setWarningItems] = useState([]);
  const [competitionState, setCompetitionState] = useState({
    isPaused: false,
    pausedAt: null,
    isStarted: false,
    startedAt: null,
    isTimeUp: false,
    puzzleCount: 20,
    wrongAnswerPenaltyMinutes: 0
  });
  const [auditItems, setAuditItems] = useState([]);
  const [importSummary, setImportSummary] = useState(null);
  const [createDraft, setCreateDraft] = useState(() => createDefaultPuzzleDraft());
  const [createTemplateType, setCreateTemplateType] = useState("custom");
  const [createTargetTeam, setCreateTargetTeam] = useState(null);
  const [metadataDraft, setMetadataDraft] = useState({
    slug: "",
    title: "",
    type: "",
    prompt: "",
    answerKey: ""
  });
  const [createFileDraft, setCreateFileDraft] = useState({
    label: "",
    url: "",
    openInNewTab: true,
    download: false
  });
  const [editFileDraft, setEditFileDraft] = useState({
    label: "",
    url: "",
    openInNewTab: true,
    download: false
  });
  const [createUploadDraft, setCreateUploadDraft] = useState({
    files: [],
    role: "regular",
    openInNewTab: true,
    download: false,
    addToExternalLinks: true,
    visibility: "shared",
    teamId: ""
  });
  const [uploadDraft, setUploadDraft] = useState({
    files: [],
    role: "regular",
    label: "",
    openInNewTab: true,
    download: false,
    addToExternalLinks: true,
    visibility: "shared",
    teamId: ""
  });
  const [latestUploadedAssetUrl, setLatestUploadedAssetUrl] = useState("");
  const [selectedTeamPool, setSelectedTeamPool] = useState(null);
  const [loadingTeamPool, setLoadingTeamPool] = useState(false);
  const [teamRemovalTargetId, setTeamRemovalTargetId] = useState("");
  const [monitorFullscreenState, setMonitorFullscreenState] = useState({
    team: false,
    leaderboard: false
  });
  const createUploadInputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const teamMonitorPanelRef = useRef(null);
  const leaderboardPanelRef = useRef(null);

  useEffect(() => {
    const onFullscreenChange = () => {
      setMonitorFullscreenState({
        team: document.fullscreenElement === teamMonitorPanelRef.current,
        leaderboard: document.fullscreenElement === leaderboardPanelRef.current
      });
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    onFullscreenChange();
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const loadPuzzles = useCallback(async () => {
    const response = await api.get("/puzzles");
    const rows = response.data?.puzzles || [];
    setPuzzles(rows);

    if (!selectedPuzzleId && rows.length > 0) {
      setSelectedPuzzleId(rows[0].id);
    }
  }, [selectedPuzzleId]);

  const loadMonitoring = useCallback(async () => {
    const [teamsRes, sessionsRes, warningsRes, eventStateRes, leaderboardRes] = await Promise.all([
      api.get("/admin/teams/monitor"),
      api.get("/admin/sessions/monitor"),
      api.get("/admin/warnings?limit=100"),
      api.get("/event/state"),
      api.get("/leaderboard")
    ]);

    setTeamMonitor(teamsRes.data?.teams || []);
    setSessionMonitor(sessionsRes.data?.sessions || []);
    setWarningItems(warningsRes.data?.items || []);
    setLeaderboardRows(Array.isArray(leaderboardRes.data?.leaderboard) ? leaderboardRes.data.leaderboard : []);
    setCompetitionState({
      isPaused: Boolean(eventStateRes.data?.competition?.isPaused),
      pausedAt: eventStateRes.data?.competition?.pausedAt || null,
      isStarted: Boolean(eventStateRes.data?.event?.isStarted),
      startedAt: eventStateRes.data?.event?.startedAt || null,
      isTimeUp: Boolean(eventStateRes.data?.competition?.isTimeUp),
      puzzleCount: Number(eventStateRes.data?.event?.puzzleCount || 20),
      wrongAnswerPenaltyMinutes: Number(eventStateRes.data?.event?.wrongAnswerPenaltyMinutes || 0)
    });
  }, []);

  const loadAuditLogs = useCallback(async () => {
    const response = await api.get("/admin/audit-logs?limit=100");
    setAuditItems(response.data?.items || []);
  }, []);

  const loadDetail = useCallback(async () => {
    if (!selectedPuzzleId) {
      setDetailAssets([]);
      return;
    }

    const [detailResponse, assetsResponse] = await Promise.all([
      api.get(`/puzzles/${selectedPuzzleId}`),
      api.get(`/puzzles/${selectedPuzzleId}/assets`)
    ]);

    const puzzle = detailResponse.data?.puzzle;
    const items = Array.isArray(assetsResponse.data?.items) ? assetsResponse.data.items : [];
    setDetail(puzzle);
    setDetailAssets(items);

    if (!puzzle) {
      return;
    }

    setBuiltinUtils(puzzle.toolConfig?.builtinUtils || []);
    setIsInspectPuzzle(Boolean(puzzle.toolConfig?.isInspectPuzzle));
    setIsolatedUrl(puzzle.toolConfig?.isolatedUrl || "");
    setExternalLinksText(JSON.stringify(puzzle.toolConfig?.externalLinks || [], null, 2));
    setMetadataDraft({
      slug: puzzle.slug || "",
      title: puzzle.title || "",
      type: puzzle.type || "",
      prompt: puzzle.prompt || "",
      answerKey: ""
    });
    setHintPenaltySeconds(Number(puzzle.hints?.[0]?.penaltySeconds || 0));
    setHintDrafts(
      Object.fromEntries(
        (puzzle.hints || []).map((hint) => [
          hint.id,
          {
            content: hint.content || "",
            penaltySeconds: Number(hint.penaltySeconds || 0)
          }
        ])
      )
    );
  }, [selectedPuzzleId]);

  const extractStoredAssetPathFromUrl = (rawUrl) => {
    try {
      const parsed = new URL(`${rawUrl || ""}`, window.location.origin);
      if (!parsed.pathname.startsWith("/puzzle-assets/")) {
        return null;
      }

      const file = parsed.searchParams.get("file");
      return file ? decodeURIComponent(file) : null;
    } catch {
      return null;
    }
  };

  const deleteUploadedAsset = async (asset) => {
    if (!selectedPuzzleId || !asset) {
      return;
    }

    const storedPath = `${asset.storedRelativePath || ""}`.trim() || extractStoredAssetPathFromUrl(asset.url);
    if (!storedPath) {
      setError("Unable to resolve file path for this asset.");
      return;
    }

    const confirmDelete = window.confirm(`Delete file \"${asset.name}\"? This cannot be undone.`);
    if (!confirmDelete) {
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");

    try {
      const response = await api.post(`/admin/puzzles/${selectedPuzzleId}/assets/delete`, {
        file: storedPath
      });

      const existingLinks = parseExternalLinks(externalLinksText);
      const nextLinks = existingLinks.filter((link) => extractStoredAssetPathFromUrl(link?.url) !== storedPath);
      if (nextLinks.length !== existingLinks.length) {
        await api.patch(`/admin/puzzles/${selectedPuzzleId}/tool-config`, {
          externalLinks: nextLinks
        });
        setExternalLinksText(JSON.stringify(nextLinks, null, 2));
      }

      const removedLinks = Number(response.data?.removedExternalLinks || 0);
      setFeedback(
        removedLinks > 0
          ? `Deleted ${asset.name} and removed ${removedLinks} linked tool reference${removedLinks === 1 ? "" : "s"}.`
          : `Deleted ${asset.name}.`
      );
      await Promise.all([loadDetail(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to delete asset file.");
    } finally {
      setSaving(false);
    }
  };

  const boot = useCallback(async () => {
    try {
      await Promise.all([loadPuzzles(), loadMonitoring(), loadAuditLogs()]);
      setError("");
    } catch (requestError) {
      if (requestError?.response?.status === 401) {
        await logout();
        return;
      }
      setError(requestError?.response?.data?.message || "Unable to load admin data.");
    } finally {
      setLoading(false);
    }
  }, [loadAuditLogs, loadMonitoring, loadPuzzles, logout]);

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    loadDetail().catch((requestError) => {
      if (requestError?.response?.status === 401) {
        logout();
        return;
      }
      setError(requestError?.response?.data?.message || "Unable to load puzzle detail.");
    });
  }, [loadDetail, logout]);

  const selectedPuzzle = useMemo(
    () => puzzles.find((row) => row.id === selectedPuzzleId) || null,
    [puzzles, selectedPuzzleId]
  );
  const participantTeams = useMemo(
    () => (teamMonitor || []).filter((row) => !row.isAdmin),
    [teamMonitor]
  );
  const selectedCreateTemplate = useMemo(
    () => PUZZLE_BASE_CONFIGS[createTemplateType] || PUZZLE_BASE_CONFIGS.custom,
    [createTemplateType]
  );

  const applyCreateTemplate = (templateKey) => {
    const template = PUZZLE_BASE_CONFIGS[templateKey] || PUZZLE_BASE_CONFIGS.custom;
    setCreateTemplateType(template.key);

    if (template.key === "custom") {
      setFeedback("Manual puzzle mode selected.");
      return;
    }

    setCreateDraft((prev) => ({
      ...prev,
      slug: prev.slug || buildTemplateSlug(template.slugPrefix),
      title: prev.title || `${template.titlePrefix} ${new Date().toISOString().slice(0, 10)}`,
      type: template.type,
      prompt: template.prompt,
      answerKey: prev.answerKey || template.answerKeyPlaceholder,
      hintPenaltySeconds: template.hintPenaltySeconds,
      builtinUtils: template.builtinUtils,
      isInspectPuzzle: Boolean(template.isInspectPuzzle),
      isolatedUrl: template.isInspectPuzzle ? template.isolatedUrl || "" : "",
      hints: {
        tier1: { ...template.hints.tier1 },
        tier2: { ...template.hints.tier2 },
        tier3: { ...template.hints.tier3 }
      }
    }));
    setError("");
    setFeedback(`${template.label} base configuration applied.`);
  };

  const copyLatestUploadedAssetLink = async () => {
    if (!latestUploadedAssetUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(latestUploadedAssetUrl);
      setFeedback("Copied uploaded asset link to clipboard.");
      setError("");
    } catch {
      setError("Unable to copy link automatically. Please copy it from the field.");
    }
  };

  const toggleBuiltin = (name) => {
    setBuiltinUtils((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
    );
  };

  const toggleCreateBuiltin = (name) => {
    setCreateDraft((prev) => ({
      ...prev,
      builtinUtils: prev.builtinUtils.includes(name)
        ? prev.builtinUtils.filter((item) => item !== name)
        : [...prev.builtinUtils, name]
    }));
  };

  const updateCreateHint = (tier, field, value) => {
    setCreateDraft((prev) => ({
      ...prev,
      hints: {
        ...prev.hints,
        [tier]: {
          ...prev.hints[tier],
          [field]: value
        }
      }
    }));
  };

  const addCreateManualFile = () => {
    try {
      const label = createFileDraft.label.trim();
      const url = createFileDraft.url.trim();
      if (!label || !url) {
        throw new Error("File label and URL are required.");
      }

      const nextText = appendExternalLinkJson(createDraft.externalLinksText, {
        label,
        url,
        openInNewTab: Boolean(createFileDraft.openInNewTab),
        bypassAntiCheat: true,
        download: Boolean(createFileDraft.download)
      });
      setCreateDraft((prev) => ({ ...prev, externalLinksText: nextText }));
      setCreateFileDraft({ label: "", url: "", openInNewTab: true, download: false });
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Unable to add file link.");
    }
  };

  const addEditManualFile = () => {
    try {
      const label = editFileDraft.label.trim();
      const url = editFileDraft.url.trim();
      if (!label || !url) {
        throw new Error("File label and URL are required.");
      }

      const nextText = appendExternalLinkJson(externalLinksText, {
        label,
        url,
        openInNewTab: Boolean(editFileDraft.openInNewTab),
        bypassAntiCheat: true,
        download: Boolean(editFileDraft.download)
      });
      setExternalLinksText(nextText);
      setEditFileDraft({ label: "", url: "", openInNewTab: true, download: false });
      setError("");
    } catch (requestError) {
      setError(requestError.message || "Unable to add file link.");
    }
  };

  const buildExternalLinksFromAssets = ({ assets, fallbackLabel = "", openInNewTab, download }) =>
    assets
      .filter((asset) => asset?.url)
      .map((asset, index) => ({
        label:
          (index === 0 && fallbackLabel.trim() ? fallbackLabel.trim() : "") ||
          asset.name ||
          `Uploaded file ${index + 1}`,
        url: asset.url,
        openInNewTab: Boolean(openInNewTab),
        bypassAntiCheat: true,
        download: Boolean(download)
      }));

  const uploadAssetsForPuzzle = async ({ puzzleId, files, teamId, role = "regular" }) => {
    const form = new FormData();
    files.forEach((file) => {
      form.append("files", file);
    });

    form.append("role", role);

    if (teamId) {
      form.append("teamId", teamId);
    }

    const response = await api.post(`/admin/puzzles/${puzzleId}/assets/batch`, form, {
      headers: {
        "Content-Type": "multipart/form-data"
      }
    });

    return Array.isArray(response.data?.assets) ? response.data.assets : [];
  };

  const uploadPuzzleAsset = async (uploadRole = "reference") => {
    if (!selectedPuzzleId) {
      setError("Select a puzzle before uploading assets.");
      return;
    }

    if (!uploadDraft.files.length) {
      setError("Choose one or more image/audio files first.");
      return;
    }

    const scopedTeamId =
      uploadDraft.visibility === "team"
        ? `${uploadDraft.teamId || createTargetTeam?.id || ""}`.trim()
        : "";

    if (uploadDraft.visibility === "team" && !scopedTeamId) {
      setError("Select the team that should be allowed to view this asset.");
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");

    try {
      const assets = await uploadAssetsForPuzzle({
        puzzleId: selectedPuzzleId,
        files: uploadDraft.files,
        teamId: scopedTeamId,
        role: uploadRole
      });

      const firstAsset = assets[0] || null;
      let message = `Uploaded ${assets.length} file${assets.length === 1 ? "" : "s"} successfully.`;
      if (firstAsset?.visibility === "team" && firstAsset?.team?.name) {
        message += ` Visible only to ${firstAsset.team.name}.`;
      }
      if (firstAsset?.url) {
        message += ` First link: ${firstAsset.url}`;
        setLatestUploadedAssetUrl(firstAsset.url);
      }

      if (uploadRole === "solution" || assets.some((asset) => asset?.role === "solution")) {
        message += " Checker file uploaded and hidden from participants.";
      }

      if (uploadRole !== "solution" && uploadDraft.addToExternalLinks && assets.length) {
        const linksToAdd = buildExternalLinksFromAssets({
          assets,
          fallbackLabel: uploadDraft.label,
          openInNewTab: uploadDraft.openInNewTab,
          download: uploadDraft.download
        });
        const parsedExisting = parseExternalLinks(externalLinksText);
        const nextText = JSON.stringify([...parsedExisting, ...linksToAdd], null, 2);
        setExternalLinksText(nextText);
        message += " Links added to External Links JSON. Click Save Tool Config to apply.";
      }

      setFeedback(message);
      setUploadDraft((prev) => ({
        ...prev,
        files: [],
        label: ""
      }));
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
      if (firstAsset?.url) {
        setEditFileDraft((prev) => ({
          ...prev,
          label: firstAsset.name || prev.label,
          url: firstAsset.url,
          download: uploadDraft.download
        }));
      }
      await loadDetail();
    } catch (requestError) {
      if (requestError?.response?.status === 401) {
        await logout();
        return;
      }
      setError(requestError?.response?.data?.message || requestError?.message || "Asset upload failed.");
    } finally {
      setSaving(false);
    }
  };

  const createPuzzle = async () => {
    setSaving(true);
    setError("");
    setFeedback("");

    try {
      const queuedUploadTeamId =
        createUploadDraft.visibility === "team"
          ? `${createUploadDraft.teamId || createTargetTeam?.id || ""}`.trim()
          : "";
      if (createUploadDraft.files.length > 0 && createUploadDraft.visibility === "team" && !queuedUploadTeamId) {
        throw new Error("Select the team for team-only uploads in the create form.");
      }

      const isTemplateMode = selectedCreateTemplate.key !== "custom";
      const externalLinks = parseExternalLinks(createDraft.externalLinksText);
      const resolvedSlug =
        createDraft.slug.trim() ||
        (isTemplateMode ? buildTemplateSlug(selectedCreateTemplate.slugPrefix) : "");
      const resolvedTitle =
        createDraft.title.trim() ||
        (isTemplateMode ? `${selectedCreateTemplate.titlePrefix} ${new Date().toISOString().slice(0, 10)}` : "");
      const resolvedType = createDraft.type.trim() || (isTemplateMode ? selectedCreateTemplate.type : "");
      const resolvedPrompt = createDraft.prompt.trim() || (isTemplateMode ? selectedCreateTemplate.prompt : "");
      const resolvedAnswerKey =
        createDraft.answerKey.trim() ||
        (isTemplateMode ? selectedCreateTemplate.answerKeyPlaceholder : "");

      const hintPenaltyDraft = Number(createDraft.hintPenaltySeconds);
      const resolvedHintPenalty = Number.isFinite(hintPenaltyDraft)
        ? hintPenaltyDraft
        : isTemplateMode
          ? selectedCreateTemplate.hintPenaltySeconds
           : 0;

      const buildHintPayload = (tier) => {
        const draftHint = createDraft.hints[tier] || { content: "", penaltySeconds: 0 };
        const fallbackHint = isTemplateMode ? selectedCreateTemplate.hints[tier] : null;
        return {
          tier,
          content: `${draftHint.content || fallbackHint?.content || ""}`.trim(),
          penaltySeconds: Number(draftHint.penaltySeconds || fallbackHint?.penaltySeconds || 0)
        };
      };

      const payload = {
        slug: resolvedSlug,
        title: resolvedTitle,
        type: resolvedType,
        prompt: resolvedPrompt,
        answerKey: resolvedAnswerKey,
        hintPenaltySeconds: resolvedHintPenalty,
        builtinUtils: createDraft.builtinUtils,
        externalLinks,
        isInspectPuzzle: Boolean(createDraft.isInspectPuzzle),
        isolatedUrl: createDraft.isInspectPuzzle ? createDraft.isolatedUrl.trim() || null : null,
        hints: [buildHintPayload("tier1"), buildHintPayload("tier2"), buildHintPayload("tier3")]
      };

      const response = await api.post("/admin/puzzles", payload);
      let feedbackMessage = "Puzzle created successfully.";

      const createdPuzzleId = response.data?.puzzle?.id;
      const filesToUpload = [...createUploadDraft.files];
      if (
        isTemplateMode &&
        selectedCreateTemplate.readmeFileName &&
        selectedCreateTemplate.readmeContent
      ) {
        const hasReadme = filesToUpload.some(
          (file) => `${file?.name || ""}`.toLowerCase() === selectedCreateTemplate.readmeFileName.toLowerCase()
        );
        if (!hasReadme) {
          filesToUpload.unshift(
            new File([selectedCreateTemplate.readmeContent], selectedCreateTemplate.readmeFileName, {
              type: "text/plain"
            })
          );
        }
      }

      if (createdPuzzleId && filesToUpload.length > 0) {
        const uploadedAssets = await uploadAssetsForPuzzle({
          puzzleId: createdPuzzleId,
          files: filesToUpload,
          teamId: queuedUploadTeamId,
          role: createUploadDraft.role
        });

        if (uploadedAssets.length > 0) {
          feedbackMessage += ` Uploaded ${uploadedAssets.length} file${uploadedAssets.length === 1 ? "" : "s"}.`;
          if (uploadedAssets[0]?.url) {
            setLatestUploadedAssetUrl(uploadedAssets[0].url);
            setEditFileDraft((prev) => ({
              ...prev,
              label: uploadedAssets[0].name || prev.label,
              url: uploadedAssets[0].url,
              download: createUploadDraft.download
            }));
          }
        }

        if (createUploadDraft.addToExternalLinks && uploadedAssets.length > 0) {
          const extraLinks = buildExternalLinksFromAssets({
            assets: uploadedAssets,
            fallbackLabel: "",
            openInNewTab: createUploadDraft.openInNewTab,
            download: createUploadDraft.download
          });
          await api.patch(`/admin/puzzles/${createdPuzzleId}/tool-config`, {
            externalLinks: [...externalLinks, ...extraLinks]
          });
          feedbackMessage += " Uploaded links were added to tool config.";
        }
      }

      setFeedback(feedbackMessage);
      if (isTemplateMode) {
        setCreateDraft((prev) => ({
          ...createDefaultPuzzleDraft(),
          type: selectedCreateTemplate.type,
          prompt: selectedCreateTemplate.prompt,
          answerKey: selectedCreateTemplate.answerKeyPlaceholder,
          hintPenaltySeconds: selectedCreateTemplate.hintPenaltySeconds,
          builtinUtils: selectedCreateTemplate.builtinUtils,
          isInspectPuzzle: Boolean(selectedCreateTemplate.isInspectPuzzle),
          isolatedUrl: selectedCreateTemplate.isInspectPuzzle ? selectedCreateTemplate.isolatedUrl || "" : "",
          hints: {
            tier1: { ...selectedCreateTemplate.hints.tier1 },
            tier2: { ...selectedCreateTemplate.hints.tier2 },
            tier3: { ...selectedCreateTemplate.hints.tier3 }
          },
          slug: buildTemplateSlug(selectedCreateTemplate.slugPrefix),
          title: `${selectedCreateTemplate.titlePrefix} ${new Date().toISOString().slice(0, 10)}`
        }));
      } else {
        setCreateDraft(createDefaultPuzzleDraft());
      }
      setCreateUploadDraft((prev) => ({
        ...prev,
        files: []
      }));
      if (createUploadInputRef.current) {
        createUploadInputRef.current.value = "";
      }

      await Promise.all([loadPuzzles(), loadAuditLogs()]);
      if (createdPuzzleId) {
        setSelectedPuzzleId(createdPuzzleId);
      }
    } catch (requestError) {
      if (requestError?.response?.status === 401) {
        await logout();
        return;
      }
      setError(requestError?.response?.data?.message || requestError?.message || "Puzzle creation failed.");
    } finally {
      setSaving(false);
    }
  };

  const saveToolConfig = async () => {
    if (!selectedPuzzleId) {
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const externalLinks = parseExternalLinks(externalLinksText);
      await api.patch(`/admin/puzzles/${selectedPuzzleId}/tool-config`, {
        builtinUtils,
        externalLinks,
        isInspectPuzzle,
        isolatedUrl: isolatedUrl.trim() || null
      });

      setFeedback("Tool configuration updated.");
      await loadPuzzles();
      await loadDetail();
      await loadAuditLogs();
    } catch (requestError) {
      setError(requestError?.response?.data?.message || requestError.message || "Tool config update failed.");
    } finally {
      setSaving(false);
    }
  };

  const savePuzzleMetadata = async () => {
    if (!selectedPuzzleId) {
      return;
    }

    const payload = {
      slug: metadataDraft.slug.trim(),
      title: metadataDraft.title.trim(),
      type: metadataDraft.type.trim(),
      prompt: metadataDraft.prompt,
      ...(metadataDraft.answerKey.trim() ? { answerKey: metadataDraft.answerKey.trim() } : {})
    };

    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.patch(`/admin/puzzles/${selectedPuzzleId}`, payload);
      setFeedback("Puzzle details updated.");
      setMetadataDraft((prev) => ({ ...prev, answerKey: "" }));
      await Promise.all([loadPuzzles(), loadDetail(), loadAuditLogs()]);
    } catch (requestError) {
      if (requestError?.response?.status === 401) {
        await logout();
        return;
      }
      setError(requestError?.response?.data?.message || "Unable to update puzzle details.");
    } finally {
      setSaving(false);
    }
  };

  const saveDefaultHintPenalty = async () => {
    if (!selectedPuzzleId) {
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.patch(`/admin/puzzles/${selectedPuzzleId}/penalty`, {
        hintPenaltySeconds: Number(hintPenaltySeconds)
      });
      setFeedback("Default hint penalty updated.");
      await loadDetail();
      await loadAuditLogs();
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Penalty update failed.");
    } finally {
      setSaving(false);
    }
  };

  const saveHint = async (hintId) => {
    const draft = hintDrafts[hintId];
    if (!draft) {
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.patch(`/admin/hints/${hintId}`, {
        content: draft.content
      });
      setFeedback("Hint updated.");
      await loadDetail();
      await loadAuditLogs();
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Hint update failed.");
    } finally {
      setSaving(false);
    }
  };

  const importFromPuzzleBank = async () => {
    setSaving(true);
    setError("");
    setFeedback("");

    try {
      const response = await api.post("/admin/puzzles/import-from-bank");
      setImportSummary(response.data);
      setFeedback("Puzzle bank import completed.");
      await Promise.all([loadPuzzles(), loadMonitoring(), loadAuditLogs()]);
      if (selectedPuzzleId) {
        await loadDetail();
      }
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Bulk import failed.");
    } finally {
      setSaving(false);
    }
  };

  const pauseTimerAll = async () => {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.post("/admin/timer/pause-all");
      setFeedback("Competition timer paused for all teams.");
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to pause timer.");
    } finally {
      setSaving(false);
    }
  };

  const resumeTimerAll = async () => {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.post("/admin/timer/resume-all");
      setFeedback("Competition timer resumed for all teams.");
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to resume timer.");
    } finally {
      setSaving(false);
    }
  };

  const updateEventSettings = async () => {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.patch("/admin/event-settings", {
        puzzleCount: Number(competitionState.puzzleCount || 20)
      });
      setFeedback("Event settings updated.");
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to update event settings.");
    } finally {
      setSaving(false);
    }
  };

  const startEvent = async () => {
    const confirmed = window.confirm("Start the event now and freeze puzzle assignments for all pre-registered teams?");
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.post("/admin/event-start");
      setFeedback("Event started and team puzzle orders were frozen.");
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to start the event.");
    } finally {
      setSaving(false);
    }
  };

  const endEvent = async () => {
    if (saving || !competitionState.isStarted || competitionState.isTimeUp) {
      return;
    }

    const confirmed = window.confirm("End the event now? This will stop the timer for everyone immediately.");
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.post("/admin/event-end");
      setFeedback("Event ended for all teams.");
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to end the event.");
    } finally {
      setSaving(false);
    }
  };

  const factoryResetEvent = async () => {
    if (saving) return;

    const msg = "DANGER: This will permanently wipe ALL team solves, attempts, hint penalties, and randomized puzzle paths! Are you absolutely sure?";
    if (!window.confirm(msg)) {
      return;
    }
    
    if (!window.confirm("FINAL WARNING: All event progress will be destroyed and the event will be un-started. Proceed?")) {
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const resp = await api.post("/admin/event-reset");
      setFeedback(resp.data?.message || "Event has been completely factory reset.");
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to factory reset event.");
    } finally {
      setSaving(false);
    }
  };

  const resetTimerAll = async () => {
    const confirmed = window.confirm("Reset the event timer for all teams to the default duration (60 minutes)?");
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.post("/admin/timer/reset-all");
      setFeedback("Competition timer reset for all teams.");
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to reset timer.");
    } finally {
      setSaving(false);
    }
  };

  const removePuzzleFromTeam = async () => {
    if (!selectedPuzzleId) {
      setError("Select a puzzle first.");
      return;
    }

    const resolvedTeamId = `${teamRemovalTargetId || selectedTeamPool?.team?.id || ""}`.trim();
    if (!resolvedTeamId) {
      setError("Select a team to remove this puzzle from.");
      return;
    }

    const teamLabel =
      participantTeams.find((row) => row.id === resolvedTeamId)?.name ||
      selectedTeamPool?.team?.name ||
      "the selected team";
    const confirmed = window.confirm(`Remove this puzzle from ${teamLabel}'s pool?`);
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.post(`/admin/puzzles/${selectedPuzzleId}/remove-from-team`, {
        teamId: resolvedTeamId
      });
      setFeedback("Puzzle removed from the selected team pool.");
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
      if (selectedTeamPool?.team?.id === resolvedTeamId) {
        await viewTeamPool(selectedTeamPool.team);
      }
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to remove puzzle from team.");
    } finally {
      setSaving(false);
    }
  };

  const deletePuzzleGlobally = async () => {
    if (!selectedPuzzleId || !selectedPuzzle) {
      return;
    }

    const confirmed = window.confirm(
      `Delete shared puzzle \"${selectedPuzzle.title}\" for everyone? This permanently removes puzzle data and files.`
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.delete(`/admin/puzzles/${selectedPuzzleId}`);
      setFeedback("Puzzle deleted globally.");
      setSelectedPuzzleId("");
      setDetail(null);
      setDetailAssets([]);
      await Promise.all([loadPuzzles(), loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to delete puzzle globally.");
    } finally {
      setSaving(false);
    }
  };

  const removeTargetedPuzzleForTeam = async ({ teamId, puzzleId, puzzleTitle }) => {
    if (!teamId || !puzzleId) {
      return;
    }

    const confirmed = window.confirm(
      `Remove \"${puzzleTitle || "this puzzle"}\" from the selected team's pool?`
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.post(`/admin/puzzles/${puzzleId}/remove-from-team`, {
        teamId
      });
      setFeedback("Puzzle removed from selected team pool.");
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
      if (selectedTeamPool?.team?.id === teamId) {
        await viewTeamPool(selectedTeamPool.team);
      }
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to remove targeted puzzle.");
    } finally {
      setSaving(false);
    }
  };

  const toggleMonitorPanelFullscreen = async (panelRef, panelName) => {
    const panelNode = panelRef?.current;
    if (!panelNode) {
      return;
    }

    try {
      if (document.fullscreenElement === panelNode) {
        await document.exitFullscreen();
        setFeedback(`${panelName} exited fullscreen.`);
      } else {
        await panelNode.requestFullscreen();
        setFeedback(`${panelName} opened in fullscreen.`);
      }
      setError("");
    } catch {
      setError(`Unable to toggle fullscreen for ${panelName}.`);
    }
  };

  const banAllTeams = async () => {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.post("/admin/teams/ban-all");
      setFeedback("All participant teams have been banned.");
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to ban all teams.");
    } finally {
      setSaving(false);
    }
  };

  const unbanAllTeams = async () => {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.post("/admin/teams/unban-all");
      setFeedback("All participant teams have been unbanned.");
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to unban all teams.");
    } finally {
      setSaving(false);
    }
  };

  const toggleTeamBan = async (row) => {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      if (row.isBanned) {
        await api.post(`/admin/teams/${row.id}/unban`);
        setFeedback(`${row.name} has been unbanned.`);
      } else {
        await api.post(`/admin/teams/${row.id}/ban`);
        setFeedback(`${row.name} has been banned.`);
      }
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to update team ban status.");
    } finally {
      setSaving(false);
    }
  };

  const unlockTeam = async (row) => {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await api.post(`/admin/teams/${row.id}/unlock`);
      setFeedback(`${row.name} has been unlocked and warnings reset.`);
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      setError(requestError?.response?.data?.message || "Unable to unlock team.");
    } finally {
      setSaving(false);
    }
  };

  const regenerateTeamPool = async (row, temporary = false) => {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const response = await api.post(`/admin/teams/${row.id}/puzzle-pool`, { temporary });
      setFeedback(
        temporary
          ? `Temporary pool created for ${row.name} (${response.data?.puzzleCount || 0} puzzles).`
          : `Unique pool generated for ${row.name} (${response.data?.puzzleCount || 0} puzzles).`
      );
      await Promise.all([loadMonitoring(), loadAuditLogs()]);
    } catch (requestError) {
      if (requestError?.response?.status === 401) {
        await logout();
        return;
      }
      setError(requestError?.response?.data?.message || "Unable to generate team puzzle pool.");
    } finally {
      setSaving(false);
    }
  };

  const openTeamPuzzleCreator = (row) => {
    setSection("config");
    setCreateTargetTeam({
      id: row.id,
      name: row.name,
      code: row.code
    });
    setError("");
    setFeedback(`Creating puzzle for ${row.name} (${row.code}).`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const viewTeamPool = async (row) => {
    setLoadingTeamPool(true);
    setError("");
    setFeedback("");
    try {
      const response = await api.get(`/admin/teams/${row.id}/puzzle-pool`);
      setSelectedTeamPool(response.data);
      const itemCount = Array.isArray(response.data?.items) ? response.data.items.length : 0;
      setFeedback(
        `Loaded ${itemCount} frozen puzzle${itemCount === 1 ? "" : "s"} for ${row.name}.`
      );
    } catch (requestError) {
      if (requestError?.response?.status === 401) {
        await logout();
        return;
      }
      setError(requestError?.response?.data?.message || "Unable to load team puzzle pool.");
    } finally {
      setLoadingTeamPool(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg text-fg">
        <p>Loading admin panel...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg pb-10 pt-6 text-fg">
      <div className="mx-auto max-w-7xl px-4 md:px-6">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-700/40 bg-card p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted">Admin Console</p>
            <h1 className="font-display text-2xl">Puzzle Configuration Panel</h1>
            <p className="text-sm text-muted">Signed in as {team?.name}</p>
          </div>
          <button type="button" className="rounded-xl border border-slate-500 px-3 py-2 text-sm" onClick={logout}>
            Logout
          </button>
        </header>

        <section className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-slate-700/40 bg-card p-3">
          <button
            type="button"
            onClick={() => setSection("config")}
            className={`rounded-lg px-3 py-2 text-sm ${
              section === "config" ? "bg-accent text-slate-950" : "border border-slate-600"
            }`}
          >
            Puzzle Config
          </button>
          <button
            type="button"
            onClick={() => setSection("monitor")}
            className={`rounded-lg px-3 py-2 text-sm ${
              section === "monitor" ? "bg-accent text-slate-950" : "border border-slate-600"
            }`}
          >
            Team/Session Monitor
          </button>
          <button
            type="button"
            onClick={() => setSection("import")}
            className={`rounded-lg px-3 py-2 text-sm ${
              section === "import" ? "bg-accent text-slate-950" : "border border-slate-600"
            }`}
          >
            Bulk Import
          </button>
          <button
            type="button"
            onClick={() => setSection("audit")}
            className={`rounded-lg px-3 py-2 text-sm ${
              section === "audit" ? "bg-accent text-slate-950" : "border border-slate-600"
            }`}
          >
            Audit Logs
          </button>
        </section>

        {error ? <p className="mb-3 rounded-lg bg-red-950/40 p-3 text-sm text-red-300">{error}</p> : null}
        {feedback ? <p className="mb-3 rounded-lg bg-emerald-900/30 p-3 text-sm text-emerald-200">{feedback}</p> : null}

        {section === "config" ? (
          <div className="space-y-4">
          <article className="rounded-2xl border border-slate-700/40 bg-card p-4">
            <h2 className="font-display text-xl">Create Puzzle Manually</h2>
            <p className="mt-1 text-sm text-muted">
              Required fields are validated server-side and the puzzle is added to the active event.
            </p>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block">Base Configuration</span>
              <select
                className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2"
                value={createTemplateType}
                onChange={(event) => applyCreateTemplate(event.target.value)}
              >
                {Object.values(PUZZLE_BASE_CONFIGS).map((template) => (
                  <option key={`template-${template.key}`} value={template.key}>
                    {template.label}
                  </option>
                ))}
              </select>
              {selectedCreateTemplate.key !== "custom" ? (
                <p className="mt-1 text-xs text-muted">
                  This template pre-fills prompt, hints, tools, and auto-attaches {selectedCreateTemplate.readmeFileName} on create.
                </p>
              ) : null}
            </label>

            <p className="mt-3 text-xs text-muted">
              Newly created puzzles are added to the shared event pool. Team-specific puzzle assignment is disabled once orders are frozen.
            </p>

            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="text-sm">
                <span className="mb-1 block">Slug</span>
                <input
                  className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2"
                  value={createDraft.slug}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, slug: event.target.value }))}
                  placeholder="forensic-dns-challenge"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block">Title</span>
                <input
                  className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2"
                  value={createDraft.title}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="Forensic DNS Challenge"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block">Type</span>
                <input
                  className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2"
                  value={createDraft.type}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, type: event.target.value }))}
                  placeholder="forensics"
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block">Answer Key</span>
                <textarea
                  className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 font-mono text-sm"
                  rows={3}
                  value={createDraft.answerKey}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, answerKey: event.target.value }))}
                  placeholder="FLAG{example} or paste multi-line output"
                />
              </label>
            </div>

            <label className="mt-3 block text-sm">
              <span className="mb-1 block">Prompt</span>
              <textarea
                className="h-28 w-full rounded-lg border border-slate-600 bg-slate-950/70 p-3 text-sm"
                value={createDraft.prompt}
                onChange={(event) => setCreateDraft((prev) => ({ ...prev, prompt: event.target.value }))}
                placeholder="Describe what participants need to solve and submit."
              />
            </label>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="text-sm">
                <span className="mb-1 block">Hint Costs</span>
                <p className="rounded-lg border border-slate-700/50 bg-slate-950/40 px-3 py-2 text-xs text-muted">
                  Tier 1 = 0 pts, Tier 2 = 1 pt, Tier 3 = 2 pts.
                </p>
              </div>
              <label className="text-sm">
                <span className="mb-1 block">Inspect Puzzle</span>
                <input
                  type="checkbox"
                  checked={createDraft.isInspectPuzzle}
                  onChange={(event) =>
                    setCreateDraft((prev) => ({ ...prev, isInspectPuzzle: event.target.checked }))
                  }
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block">Isolated URL</span>
                <input
                  className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2"
                  value={createDraft.isolatedUrl}
                  onChange={(event) => setCreateDraft((prev) => ({ ...prev, isolatedUrl: event.target.value }))}
                  placeholder="/challenge/forensic-dns-challenge"
                />
              </label>
            </div>

            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold">Builtin Tools</p>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {BUILTIN_UTILS.map((name) => (
                  <label key={`create-${name}`} className="flex items-center gap-2 rounded-lg border border-slate-700/50 p-2 text-sm">
                    <input
                      type="checkbox"
                      checked={createDraft.builtinUtils.includes(name)}
                      onChange={() => toggleCreateBuiltin(name)}
                    />
                    <span>{name}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className="mt-4 block text-sm">
              <span className="mb-1 block">External Links JSON</span>
              <p className="mb-1 text-xs text-muted">Optional fields: openInNewTab, bypassAntiCheat, download.</p>
              <textarea
                className="h-28 w-full rounded-lg border border-slate-600 bg-slate-950/70 p-3 font-mono text-xs"
                value={createDraft.externalLinksText}
                onChange={(event) =>
                  setCreateDraft((prev) => ({ ...prev, externalLinksText: event.target.value }))
                }
              />
            </label>

            <section className="mt-3 rounded-xl border border-slate-700/50 p-3">
              <h4 className="mb-2 text-sm font-semibold">Add File Link Manually</h4>
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  className="rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm"
                  placeholder="File label"
                  value={createFileDraft.label}
                  onChange={(event) => setCreateFileDraft((prev) => ({ ...prev, label: event.target.value }))}
                />
                <input
                  className="rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm"
                  placeholder="https://... or /puzzle-assets/..."
                  value={createFileDraft.url}
                  onChange={(event) => setCreateFileDraft((prev) => ({ ...prev, url: event.target.value }))}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createFileDraft.openInNewTab}
                    onChange={(event) =>
                      setCreateFileDraft((prev) => ({ ...prev, openInNewTab: event.target.checked }))
                    }
                  />
                  <span>Open In New Tab</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createFileDraft.download}
                    onChange={(event) =>
                      setCreateFileDraft((prev) => ({ ...prev, download: event.target.checked }))
                    }
                  />
                  <span>Download File</span>
                </label>
                <button
                  type="button"
                  onClick={addCreateManualFile}
                  className="rounded-lg border border-slate-500 px-3 py-1"
                >
                  Add To JSON
                </button>
              </div>
            </section>

            <section className="mt-3 rounded-xl border border-slate-700/50 p-3">
              <h4 className="mb-2 text-sm font-semibold">Upload Files (Multiple)</h4>
              <p className="mb-2 text-xs text-muted">
                Select one or more files. You can reopen the picker to add more before creating the puzzle.
              </p>
              <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="create-asset-visibility"
                    checked={createUploadDraft.visibility === "shared"}
                    onChange={() =>
                      setCreateUploadDraft((prev) => ({
                        ...prev,
                        visibility: "shared"
                      }))
                    }
                  />
                  <span>Shared</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="create-asset-visibility"
                    checked={createUploadDraft.visibility === "team"}
                    onChange={() =>
                      setCreateUploadDraft((prev) => ({
                        ...prev,
                        visibility: "team",
                        teamId: prev.teamId || createTargetTeam?.id || ""
                      }))
                    }
                  />
                  <span>Team-only</span>
                </label>
              </div>
              <label className="mb-2 block text-sm">
                <span className="mb-1 block text-xs">Upload Role</span>
                <select
                  className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm"
                  value={createUploadDraft.role}
                  onChange={(event) =>
                    setCreateUploadDraft((prev) => ({
                      ...prev,
                      role: event.target.value
                    }))
                  }
                >
                  <option value="regular">Puzzle File (normal)</option>
                  <option value="reference">Reference File (participant visible)</option>
                  <option value="solution">Correct File (hidden, for verifier)</option>
                </select>
                {createUploadDraft.role === "solution" ? (
                  <p className="mt-1 text-xs text-amber-300">
                    Correct files are hidden from participants and used for code verification.
                  </p>
                ) : null}
              </label>
              {createUploadDraft.visibility === "team" ? (
                <label className="mb-2 block text-sm">
                  <span className="mb-1 block text-xs">Allowed Team</span>
                  <select
                    className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm"
                    value={createUploadDraft.teamId || createTargetTeam?.id || ""}
                    onChange={(event) =>
                      setCreateUploadDraft((prev) => ({
                        ...prev,
                        teamId: event.target.value
                      }))
                    }
                  >
                    <option value="">Select a team</option>
                    {participantTeams.map((row) => (
                      <option key={`create-upload-team-${row.id}`} value={row.id}>
                        {row.name} ({row.code})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <input
                ref={createUploadInputRef}
                type="file"
                multiple
                accept={UPLOAD_ACCEPT_LIST}
                className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm"
                onChange={(event) => {
                  const files = Array.from(event.target.files || []);
                  setCreateUploadDraft((prev) => ({
                    ...prev,
                    files: mergeQueuedFiles(prev.files, files)
                  }));
                  event.target.value = "";
                }}
              />
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createUploadDraft.addToExternalLinks}
                    onChange={(event) =>
                      setCreateUploadDraft((prev) => ({ ...prev, addToExternalLinks: event.target.checked }))
                    }
                  />
                  <span>Add links to tool config</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createUploadDraft.openInNewTab}
                    onChange={(event) =>
                      setCreateUploadDraft((prev) => ({ ...prev, openInNewTab: event.target.checked }))
                    }
                  />
                  <span>Open In New Tab</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createUploadDraft.download}
                    onChange={(event) =>
                      setCreateUploadDraft((prev) => ({ ...prev, download: event.target.checked }))
                    }
                  />
                  <span>Download File</span>
                </label>
                <span className="text-muted">
                  {createUploadDraft.files.length} file{createUploadDraft.files.length === 1 ? "" : "s"} queued
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCreateUploadDraft((prev) => ({ ...prev, files: [] }));
                    if (createUploadInputRef.current) {
                      createUploadInputRef.current.value = "";
                    }
                  }}
                  className="rounded-lg border border-slate-500 px-2 py-1"
                >
                  Clear Queue
                </button>
              </div>
            </section>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {(["tier1", "tier2", "tier3"]).map((tier) => (
                <section key={`create-${tier}`} className="rounded-xl border border-slate-700/50 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-300">{tier}</p>
                  <textarea
                    className="h-24 w-full rounded-lg border border-slate-600 bg-slate-950/70 p-2 text-sm"
                    value={createDraft.hints[tier].content}
                    onChange={(event) => updateCreateHint(tier, "content", event.target.value)}
                    placeholder={`Hint content for ${tier}`}
                  />
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm"
                    type="number"
                    min="0"
                    value={createDraft.hints[tier].penaltySeconds}
                    onChange={(event) => updateCreateHint(tier, "penaltySeconds", event.target.value)}
                  />
                </section>
              ))}
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={createPuzzle}
              className="mt-4 rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
            >
              Create Puzzle
            </button>
          </article>

          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <aside className="rounded-2xl border border-slate-700/40 bg-card p-4">
            <h2 className="mb-3 text-sm uppercase tracking-[0.2em] text-muted">Puzzles</h2>
            <div className="space-y-2">
              {puzzles.map((puzzle) => (
                <button
                  key={puzzle.id}
                  type="button"
                  onClick={() => setSelectedPuzzleId(puzzle.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                    selectedPuzzleId === puzzle.id
                      ? "border-amber-400 bg-amber-500/20"
                      : "border-slate-600/50 bg-slate-900/30"
                  }`}
                >
                  <p className="font-semibold">{puzzle.title}</p>
                  <p className="text-xs text-muted">{puzzle.slug}</p>
                </button>
              ))}
            </div>
          </aside>

          <section className="space-y-4">
            <article className="rounded-2xl border border-slate-700/40 bg-card p-4">
              <h3 className="mb-3 font-semibold">Edit Puzzle Details</h3>
              {!selectedPuzzleId ? (
                <p className="text-sm text-muted">Select a puzzle to edit its metadata.</p>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-sm">
                      <span className="mb-1 block">Slug</span>
                      <input
                        className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2"
                        value={metadataDraft.slug}
                        onChange={(event) => setMetadataDraft((prev) => ({ ...prev, slug: event.target.value }))}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block">Title</span>
                      <input
                        className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2"
                        value={metadataDraft.title}
                        onChange={(event) => setMetadataDraft((prev) => ({ ...prev, title: event.target.value }))}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block">Type</span>
                      <input
                        className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2"
                        value={metadataDraft.type}
                        onChange={(event) => setMetadataDraft((prev) => ({ ...prev, type: event.target.value }))}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block">New Answer Key (optional)</span>
                      <textarea
                        className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 font-mono text-sm"
                        rows={3}
                        value={metadataDraft.answerKey}
                        onChange={(event) => setMetadataDraft((prev) => ({ ...prev, answerKey: event.target.value }))}
                        placeholder="Leave empty to keep existing"
                      />
                    </label>
                  </div>
                  <label className="mt-3 block text-sm">
                    <span className="mb-1 block">Prompt</span>
                    <textarea
                      className="h-28 w-full rounded-lg border border-slate-600 bg-slate-950/70 p-3"
                      value={metadataDraft.prompt}
                      onChange={(event) => setMetadataDraft((prev) => ({ ...prev, prompt: event.target.value }))}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={saving || !selectedPuzzleId}
                    onClick={savePuzzleMetadata}
                    className="mt-3 rounded-xl border border-slate-500 px-4 py-2 text-sm"
                  >
                    Save Puzzle Details
                  </button>

                  <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/20 p-3">
                    <p className="text-sm font-semibold text-rose-200">Delete Puzzle</p>
                    <p className="mt-1 text-xs text-rose-100/80">
                      Frozen event orders do not support removing a puzzle from only one team. Global deletion remains available before event start.
                    </p>
                    <button
                      type="button"
                      disabled={saving || !selectedPuzzleId}
                      onClick={deletePuzzleGlobally}
                      className="mt-2 rounded-lg border border-rose-400/70 px-3 py-2 text-xs text-rose-200 disabled:opacity-50"
                    >
                      Delete Shared Puzzle Globally
                    </button>
                  </div>
                </>
              )}
            </article>

            <article className="rounded-2xl border border-slate-700/40 bg-card p-4">
              <h3 className="mb-3 font-semibold">Tool Configuration</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {BUILTIN_UTILS.map((name) => (
                  <label key={name} className="flex items-center gap-2 rounded-lg border border-slate-700/50 p-2 text-sm">
                    <input
                      type="checkbox"
                      checked={builtinUtils.includes(name)}
                      onChange={() => toggleBuiltin(name)}
                    />
                    <span>{name}</span>
                  </label>
                ))}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block">Inspect Puzzle</span>
                  <input
                    type="checkbox"
                    checked={isInspectPuzzle}
                    onChange={(event) => setIsInspectPuzzle(event.target.checked)}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block">Isolated URL</span>
                  <input
                    className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2"
                    value={isolatedUrl}
                    onChange={(event) => setIsolatedUrl(event.target.value)}
                    placeholder="/challenge/your-slug"
                  />
                </label>
              </div>

              <label className="mt-3 block text-sm">
                <span className="mb-1 block">External Links JSON</span>
                <p className="mb-1 text-xs text-muted">
                  Optional fields: openInNewTab (boolean), bypassAntiCheat (boolean), download (boolean).
                </p>
                <textarea
                  className="h-40 w-full rounded-lg border border-slate-600 bg-slate-950/70 p-3 font-mono text-xs"
                  value={externalLinksText}
                  onChange={(event) => setExternalLinksText(event.target.value)}
                />
              </label>

              <section className="mt-3 rounded-xl border border-slate-700/50 p-3">
                <h4 className="mb-2 text-sm font-semibold">Add File Link Manually</h4>
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    className="rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm"
                    placeholder="File label"
                    value={editFileDraft.label}
                    onChange={(event) => setEditFileDraft((prev) => ({ ...prev, label: event.target.value }))}
                  />
                  <input
                    className="rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm"
                    placeholder="https://... or /puzzle-assets/..."
                    value={editFileDraft.url}
                    onChange={(event) => setEditFileDraft((prev) => ({ ...prev, url: event.target.value }))}
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editFileDraft.openInNewTab}
                      onChange={(event) =>
                        setEditFileDraft((prev) => ({ ...prev, openInNewTab: event.target.checked }))
                      }
                    />
                    <span>Open In New Tab</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editFileDraft.download}
                      onChange={(event) =>
                        setEditFileDraft((prev) => ({ ...prev, download: event.target.checked }))
                      }
                    />
                    <span>Download File</span>
                  </label>
                  <button
                    type="button"
                    onClick={addEditManualFile}
                    className="rounded-lg border border-slate-500 px-3 py-1"
                  >
                    Add To JSON
                  </button>
                </div>
              </section>

              <section className="mt-3 rounded-xl border border-slate-700/50 p-3">
                <h4 className="mb-2 text-sm font-semibold">Upload Local Files</h4>
                <p className="mb-2 text-xs text-muted">
                  Select one or more files. Reopen the picker anytime to add more before uploading.
                </p>
                <div className="mb-2 flex flex-wrap items-center gap-4 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="asset-visibility"
                      checked={uploadDraft.visibility === "shared"}
                      onChange={() =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          visibility: "shared"
                        }))
                      }
                    />
                    <span>Shared (all teams that can access this puzzle)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="asset-visibility"
                      checked={uploadDraft.visibility === "team"}
                      onChange={() =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          visibility: "team",
                          teamId: prev.teamId || createTargetTeam?.id || ""
                        }))
                      }
                    />
                    <span>Team-only</span>
                  </label>
                </div>
                {uploadDraft.visibility === "team" ? (
                  <label className="mb-2 block text-sm">
                    <span className="mb-1 block text-xs">Allowed Team</span>
                    <select
                      className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm"
                      value={uploadDraft.teamId || createTargetTeam?.id || ""}
                      onChange={(event) =>
                        setUploadDraft((prev) => ({
                          ...prev,
                          teamId: event.target.value
                        }))
                      }
                    >
                      <option value="">Select a team</option>
                      {participantTeams.map((row) => (
                        <option key={`upload-team-${row.id}`} value={row.id}>
                          {row.name} ({row.code})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="grid gap-2 md:grid-cols-2">
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    accept={UPLOAD_ACCEPT_LIST}
                    className="rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm"
                    onChange={(event) => {
                      const files = Array.from(event.target.files || []);
                      setUploadDraft((prev) => ({
                        ...prev,
                        files: mergeQueuedFiles(prev.files, files),
                        label: prev.label || files[0]?.name || ""
                      }));
                      event.target.value = "";
                    }}
                  />
                  <input
                    className="rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-sm"
                    placeholder="Link label (optional)"
                    value={uploadDraft.label}
                    onChange={(event) =>
                      setUploadDraft((prev) => ({ ...prev, label: event.target.value }))
                    }
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={uploadDraft.addToExternalLinks}
                      onChange={(event) =>
                        setUploadDraft((prev) => ({ ...prev, addToExternalLinks: event.target.checked }))
                      }
                    />
                    <span>Add to External Links JSON</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={uploadDraft.openInNewTab}
                      onChange={(event) =>
                        setUploadDraft((prev) => ({ ...prev, openInNewTab: event.target.checked }))
                      }
                    />
                    <span>Open In New Tab</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={uploadDraft.download}
                      onChange={(event) =>
                        setUploadDraft((prev) => ({ ...prev, download: event.target.checked }))
                      }
                    />
                    <span>Download File</span>
                  </label>
                  <span className="text-muted">
                    Use the buttons below to upload this queue as either participant reference files or hidden verifier files.
                  </span>
                  {`${detail?.type || ""}`.toLowerCase() === "fix_errors" ? (
                    <span className="text-amber-200">
                      For Fix Errors puzzles, upload the buggy participant file as a Reference File and the organizer solution as a Hidden Verifier File.
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <button
                    type="button"
                    disabled={
                      saving ||
                      !selectedPuzzleId ||
                      !uploadDraft.files.length ||
                      (uploadDraft.visibility === "team" && !(uploadDraft.teamId || createTargetTeam?.id))
                    }
                    onClick={() => uploadPuzzleAsset("reference")}
                    className="rounded-lg border border-slate-500 px-3 py-1 disabled:opacity-50"
                  >
                    Upload Reference Files (Participant)
                  </button>
                  <button
                    type="button"
                    disabled={
                      saving ||
                      !selectedPuzzleId ||
                      !uploadDraft.files.length ||
                      (uploadDraft.visibility === "team" && !(uploadDraft.teamId || createTargetTeam?.id))
                    }
                    onClick={() => uploadPuzzleAsset("solution")}
                    className="rounded-lg border border-amber-400/60 px-3 py-1 text-amber-200 disabled:opacity-50"
                  >
                    Upload Verifier Files (Hidden)
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <span className="text-muted">
                    {uploadDraft.files.length} file{uploadDraft.files.length === 1 ? "" : "s"} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setUploadDraft((prev) => ({ ...prev, files: [] }));
                      if (uploadInputRef.current) {
                        uploadInputRef.current.value = "";
                      }
                    }}
                    className="rounded-lg border border-slate-500 px-2 py-1"
                  >
                    Clear Queue
                  </button>
                </div>
                {latestUploadedAssetUrl ? (
                  <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                    <input
                      readOnly
                      value={latestUploadedAssetUrl}
                      className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={copyLatestUploadedAssetLink}
                      className="rounded-lg border border-slate-500 px-3 py-2 text-xs"
                    >
                      Copy Link
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 rounded-xl border border-slate-700/50 p-3">
                  <h5 className="mb-2 text-sm font-semibold">Uploaded Puzzle Files</h5>
                  {detailAssets.length === 0 ? (
                    <p className="text-xs text-muted">No uploaded assets found for this puzzle.</p>
                  ) : (
                    <div className="max-h-56 space-y-2 overflow-auto">
                      {detailAssets.map((asset) => (
                        <section
                          key={`${asset.storedRelativePath || asset.url || asset.relativePath}-${asset.role || "regular"}`}
                          className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="font-semibold text-slate-100">{asset.name}</p>
                              <p className="text-muted">
                                {asset.visibility} - {asset.role || "regular"} - {asset.relativePath}
                              </p>
                            </div>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => deleteUploadedAsset(asset)}
                              className="rounded border border-rose-400/70 px-2 py-1 text-[11px] text-rose-200 disabled:opacity-50"
                            >
                              Delete
                            </button>
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <button
                type="button"
                disabled={saving || !selectedPuzzleId}
                onClick={saveToolConfig}
                className="mt-3 rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
              >
                Save Tool Config
              </button>
            </article>

            <article className="rounded-2xl border border-slate-700/40 bg-card p-4">
              <h3 className="mb-3 font-semibold">Hint Scoring</h3>
              <p className="text-sm text-muted">
                Default hint penalties are disabled. Hint costs are fixed by tier: tier-1 = 0 pts, tier-2 = 1 pt, tier-3 = 2 pts.
              </p>
            </article>

            <article className="rounded-2xl border border-slate-700/40 bg-card p-4">
              <h3 className="mb-3 font-semibold">Hint Editor</h3>
              <div className="space-y-3">
                {(detail?.hints || []).map((hint) => {
                  const draft = hintDrafts[hint.id] || { content: "", penaltySeconds: 0 };
                  return (
                    <section key={hint.id} className="rounded-xl border border-slate-700/50 p-3">
                      <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-amber-300">{hint.tier}</p>
                      <textarea
                        className="h-24 w-full rounded-lg border border-slate-600 bg-slate-950/70 p-2 text-sm"
                        value={draft.content}
                        onChange={(event) =>
                          setHintDrafts((prev) => ({
                            ...prev,
                            [hint.id]: {
                              ...draft,
                              content: event.target.value
                            }
                          }))
                        }
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <p className="rounded-lg border border-slate-700/50 bg-slate-950/40 px-3 py-2 text-xs text-muted">
                          Fixed cost: {hint.tier === "tier1" ? "0 pts" : hint.tier === "tier2" ? "1 pt" : "2 pts"}
                        </p>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => saveHint(hint.id)}
                          className="rounded-lg border border-slate-500 px-3 py-2 text-sm"
                        >
                          Save {hint.tier}
                        </button>
                      </div>
                    </section>
                  );
                })}
              </div>
            </article>
          </section>
        </div>
        </div>
        ) : null}

        {section === "monitor" ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <article ref={teamMonitorPanelRef} className="rounded-2xl border border-slate-700/40 bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Team Monitoring</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-500 px-3 py-1 text-xs"
                    onClick={() =>
                      toggleMonitorPanelFullscreen(
                        teamMonitorPanelRef,
                        "Team Monitoring"
                      )
                    }
                  >
                    {monitorFullscreenState.team ? "Exit Fullscreen" : "Fullscreen"}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-500 px-3 py-1 text-xs"
                    onClick={() => loadMonitoring().catch(() => {})}
                  >
                    Refresh
                  </button>
                </div>
              </div>

              <div className="mb-3 rounded-xl border border-slate-700/50 bg-slate-900/40 p-3 text-sm">
                <p className="font-semibold">
                  Competition Timer: {competitionState.isTimeUp ? "Ended" : competitionState.isPaused ? "Paused" : competitionState.isStarted ? "Running" : "Not Started"}
                </p>
                <p className="text-xs text-muted">
                  {competitionState.isStarted && competitionState.startedAt
                    ? `Started at ${new Date(competitionState.startedAt).toLocaleString()}`
                    : "Event has not started yet"}
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="text-xs">
                    <span className="mb-1 block text-muted">Puzzle Count</span>
                    <input
                      type="number"
                      min="20"
                      max="26"
                      value={competitionState.puzzleCount}
                      disabled={saving || competitionState.isStarted}
                      onChange={(event) =>
                        setCompetitionState((previous) => ({
                          ...previous,
                          puzzleCount: event.target.value
                        }))
                      }
                      className="w-full rounded-lg border border-slate-600 bg-slate-950/70 px-3 py-2"
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || competitionState.isStarted}
                    onClick={updateEventSettings}
                    className="rounded-lg border border-cyan-400/70 px-3 py-1 text-xs disabled:opacity-50"
                  >
                    Save Event Settings
                  </button>
                  <button
                    type="button"
                    disabled={saving || competitionState.isStarted}
                    onClick={startEvent}
                    className="rounded-lg border border-emerald-400/70 px-3 py-1 text-xs disabled:opacity-50"
                  >
                    Start Event
                  </button>
                  <button
                    type="button"
                    disabled={saving || !competitionState.isStarted || competitionState.isPaused}
                    onClick={pauseTimerAll}
                    className="rounded-lg border border-amber-400/70 px-3 py-1 text-xs disabled:opacity-50"
                  >
                    Pause All Timers
                  </button>
                  <button
                    type="button"
                    disabled={saving || !competitionState.isStarted || !competitionState.isPaused}
                    onClick={resumeTimerAll}
                    className="rounded-lg border border-emerald-400/70 px-3 py-1 text-xs disabled:opacity-50"
                  >
                    Resume All Timers
                  </button>
                  <button
                    type="button"
                    disabled={saving || !competitionState.isStarted || competitionState.isTimeUp}
                    onClick={endEvent}
                    className="rounded-lg border border-rose-400/70 px-3 py-1 text-xs text-rose-200 disabled:opacity-50"
                  >
                    End Event
                  </button>
                  <button
                    type="button"
                    disabled={saving || competitionState.isStarted}
                    onClick={resetTimerAll}
                    className="rounded-lg border border-sky-400/70 px-3 py-1 text-xs disabled:opacity-50"
                  >
                    Reset All Timers (60m)
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={factoryResetEvent}
                    className="rounded-lg bg-red-700 px-3 py-1 text-xs font-bold text-white hover:bg-red-600 shadow-md shadow-red-900/50 disabled:opacity-50"
                  >
                    Factory Reset Event
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={banAllTeams}
                    className="rounded-lg border border-red-400/70 px-3 py-1 text-xs disabled:opacity-50"
                  >
                    Ban All Teams
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={unbanAllTeams}
                    className="rounded-lg border border-cyan-400/70 px-3 py-1 text-xs disabled:opacity-50"
                  >
                    Unban All Teams
                  </button>
                </div>
              </div>

              <div className="max-h-[520px] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-muted">
                      <th className="pb-2">Team</th>
                      <th className="pb-2">Active Sessions</th>
                      <th className="pb-2">Points</th>
                      <th className="pb-2">Hint Penalty</th>
                      <th className="pb-2">Attempts</th>
                      <th className="pb-2">Total Time</th>
                      <th className="pb-2">Warnings</th>
                      <th className="pb-2">Status</th>
                      <th className="pb-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamMonitor.map((row) => (
                      <tr key={row.id} className="border-t border-slate-700/40">
                        <td className="py-2">
                          <p className="font-semibold">{row.name}</p>
                          <p className="text-[11px] text-muted">{row.code}</p>
                        </td>
                        <td className="py-2">{row.activeSessionCount}</td>
                        <td className="py-2">{row.points}</td>
                        <td className="py-2">{row.hintPenaltyPoints ?? 0} pts</td>
                        <td className="py-2">{row.attemptCount}</td>
                        <td className="py-2">
                          {row.totalElapsedSeconds !== null && row.totalElapsedSeconds !== undefined
                            ? `${Math.floor(row.totalElapsedSeconds / 60)}m ${row.totalElapsedSeconds % 60}s`
                            : "--"}
                        </td>
                        <td className="py-2">{row.warningCount}</td>
                        <td className="py-2">
                          {row.isAdmin ? (
                            <span className="rounded bg-slate-700/60 px-2 py-0.5 text-[10px]">ADMIN</span>
                          ) : row.isBanned ? (
                            <span className="rounded bg-red-900/60 px-2 py-0.5 text-[10px]">BANNED</span>
                          ) : row.isLocked ? (
                            <span className="rounded bg-amber-800/70 px-2 py-0.5 text-[10px]">LOCKED</span>
                          ) : (
                            <span className="rounded bg-emerald-900/40 px-2 py-0.5 text-[10px]">ACTIVE</span>
                          )}
                        </td>
                        <td className="py-2">
                          {row.isAdmin ? (
                            <span className="text-muted">-</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => toggleTeamBan(row)}
                                className="rounded border border-slate-500 px-2 py-1 text-[10px] disabled:opacity-50"
                              >
                                {row.isBanned ? "Unban" : "Ban"}
                              </button>
                              <button
                                type="button"
                                disabled={saving || !row.isLocked}
                                onClick={() => unlockTeam(row)}
                                className="rounded border border-amber-400/70 px-2 py-1 text-[10px] disabled:opacity-50"
                              >
                                Unlock
                              </button>
                              <button
                                type="button"
                                disabled={saving || loadingTeamPool}
                                onClick={() => viewTeamPool(row)}
                                className="rounded border border-sky-400/70 px-2 py-1 text-[10px] disabled:opacity-50"
                              >
                                Puzzle Order
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <div className="space-y-4">
              <article className="rounded-2xl border border-slate-700/40 bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold">Team Puzzle Pool</h2>
                  {selectedTeamPool ? (
                    <button
                      type="button"
                      className="rounded-lg border border-slate-500 px-3 py-1 text-xs"
                      onClick={() => setSelectedTeamPool(null)}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>

                {!selectedTeamPool ? (
                  <p className="text-sm text-muted">
                    Click Puzzle Order for any team to inspect its frozen puzzle sequence.
                  </p>
                ) : (
                  <>
                    <p className="mb-2 text-sm">
                      <span className="font-semibold">{selectedTeamPool.team?.name}</span> ({selectedTeamPool.team?.code})
                    </p>
                    {Array.isArray(selectedTeamPool.items) && selectedTeamPool.items.length > 0 ? (
                      <div className="max-h-[260px] space-y-2 overflow-auto">
                        {selectedTeamPool.items.map((item) => (
                          <section key={item.puzzleId} className="rounded-lg border border-slate-700/50 p-3 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-semibold">#{item.orderIndex} {item.title}</p>
                              <div className="flex items-center gap-2">
                                <p className="text-muted uppercase">{item.status}</p>
                              </div>
                            </div>
                            <p className="text-muted">{item.slug} - {item.type}</p>
                          </section>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted">
                        No frozen puzzle order is available for this team yet.
                      </p>
                    )}
                  </>
                )}
              </article>

              <article ref={leaderboardPanelRef} className={`rounded-2xl border border-slate-700/40 bg-card ${monitorFullscreenState.leaderboard ? "flex flex-col h-full p-6" : "p-4"}`}>
                <div className={`flex items-center justify-between ${monitorFullscreenState.leaderboard ? "mb-4" : "mb-3"}`}>
                  <h2 className={monitorFullscreenState.leaderboard ? "text-2xl font-bold" : "font-semibold"}>Leaderboard</h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={`rounded-lg border border-slate-500 ${monitorFullscreenState.leaderboard ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs"}`}
                      onClick={() =>
                        toggleMonitorPanelFullscreen(
                          leaderboardPanelRef,
                          "Leaderboard"
                        )
                      }
                    >
                      {monitorFullscreenState.leaderboard ? "Exit Fullscreen" : "Fullscreen"}
                    </button>
                    <button
                      type="button"
                      className={`rounded-lg border border-slate-500 ${monitorFullscreenState.leaderboard ? "px-4 py-2 text-sm" : "px-3 py-1 text-xs"}`}
                      onClick={() => loadMonitoring().catch(() => {})}
                    >
                      Refresh
                    </button>
                  </div>
                </div>
                {leaderboardRows.length === 0 ? (
                  <p className={monitorFullscreenState.leaderboard ? "text-lg text-muted" : "text-sm text-muted"}>No leaderboard data yet.</p>
                ) : (
                  <div className={`space-y-2 overflow-auto ${monitorFullscreenState.leaderboard ? "flex-1" : "max-h-[260px]"}`}>
                    {leaderboardRows.map((entry) => (
                      <section key={`leader-${entry.team.id}`} className={`rounded-lg border border-slate-700/50 ${monitorFullscreenState.leaderboard ? "p-4 text-base" : "p-3 text-xs"}`}>
                        <div className="flex items-center justify-between gap-2">
                          <p className={monitorFullscreenState.leaderboard ? "text-xl font-bold" : "font-semibold"}>#{entry.rank} {entry.team.name}</p>
                          <p className={`text-emerald-300 font-bold ${monitorFullscreenState.leaderboard ? "text-xl" : ""}`}>{entry.points} pts</p>
                        </div>
                        <p className={`text-muted ${monitorFullscreenState.leaderboard ? "text-sm mt-1" : ""}`}>
                          Solved: {entry.solvedCount ?? 0} | Hint penalty: {entry.hintPenaltyPoints ?? 0} pts | Total time: {entry.totalElapsedSeconds !== null && entry.totalElapsedSeconds !== undefined ? `${Math.floor(entry.totalElapsedSeconds / 60)}m ${entry.totalElapsedSeconds % 60}s` : "--"}
                        </p>
                      </section>
                    ))}
                  </div>
                )}
              </article>

              <article className="rounded-2xl border border-slate-700/40 bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold">Active Sessions</h2>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-500 px-3 py-1 text-xs"
                    onClick={() => loadMonitoring().catch(() => {})}
                  >
                    Refresh
                  </button>
                </div>
                <div className="max-h-[240px] space-y-2 overflow-auto">
                  {sessionMonitor.length === 0 ? (
                    <p className="text-sm text-muted">No active sessions.</p>
                  ) : (
                    sessionMonitor.map((session) => (
                      <section key={session.id} className="rounded-lg border border-slate-700/50 p-3 text-xs">
                        <p className="font-semibold">{session.team?.name || "Unknown"}</p>
                        <p className="text-muted">{session.team?.code}</p>
                        <p className="mt-1">Created: {new Date(session.createdAt).toLocaleString()}</p>
                        <p>Expires: {new Date(session.expiresAt).toLocaleString()}</p>
                      </section>
                    ))
                  )}
                </div>
              </article>

              <article className="rounded-2xl border border-slate-700/40 bg-card p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold">Warning Log</h2>
                  <button
                    type="button"
                    className="rounded-lg border border-slate-500 px-3 py-1 text-xs"
                    onClick={() => loadMonitoring().catch(() => {})}
                  >
                    Refresh
                  </button>
                </div>
                <div className="max-h-[260px] space-y-2 overflow-auto">
                  {warningItems.length === 0 ? (
                    <p className="text-sm text-muted">No warnings recorded yet.</p>
                  ) : (
                    warningItems.map((item) => (
                      <section key={item.id} className="rounded-lg border border-slate-700/50 p-3 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold">
                            {item.team?.name || "Unknown Team"} ({item.team?.code || "n/a"})
                          </p>
                          <p className="text-muted">#{item.warningNumber}</p>
                        </div>
                        <p className="mt-1 uppercase tracking-wide text-amber-300">{item.type}</p>
                        <p className="mt-1 text-muted">{item.detail || "No detail provided."}</p>
                        <p className="mt-1 text-muted">{new Date(item.createdAt).toLocaleString()}</p>
                      </section>
                    ))
                  )}
                </div>
              </article>
            </div>
          </div>
        ) : null}

        {section === "import" ? (
          <article className="rounded-2xl border border-slate-700/40 bg-card p-5">
            <h2 className="font-display text-xl">Bulk Puzzle Import</h2>
            <p className="mt-2 text-sm text-muted">
              Import and sync puzzles directly from apps/api/puzzle_bank/puzzles.json.
            </p>
            <button
              type="button"
              disabled={saving}
              onClick={importFromPuzzleBank}
              className="mt-4 rounded-xl bg-accent px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
            >
              {saving ? "Importing..." : "Import From Puzzle Bank"}
            </button>

            {importSummary ? (
              <div className="mt-4 rounded-xl border border-slate-700/50 bg-slate-900/30 p-4 text-sm">
                <p>Total in bank: {importSummary.totalInBank}</p>
                <p>Created: {importSummary.createdCount}</p>
                <p>Updated: {importSummary.updatedCount}</p>
                <p>Deleted: {importSummary.deletedCount}</p>
                <p>Hints synced: {importSummary.hintCount}</p>
              </div>
            ) : null}
          </article>
        ) : null}

        {section === "audit" ? (
          <article className="rounded-2xl border border-slate-700/40 bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-xl">Admin Audit Log</h2>
              <button
                type="button"
                className="rounded-lg border border-slate-500 px-3 py-1 text-xs"
                onClick={() => loadAuditLogs().catch(() => {})}
              >
                Refresh
              </button>
            </div>
            <div className="max-h-[600px] space-y-2 overflow-auto">
              {auditItems.length === 0 ? (
                <p className="text-sm text-muted">No admin actions logged yet.</p>
              ) : (
                auditItems.map((item) => (
                  <section key={item.id} className="rounded-lg border border-slate-700/50 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{item.action}</p>
                      <p className="text-xs text-muted">{new Date(item.createdAt).toLocaleString()}</p>
                    </div>
                    <p className="text-xs text-muted">
                      by {item.adminTeam?.name || "Unknown"} ({item.adminTeam?.code || "n/a"})
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {item.entityType} {item.entityId ? `- ${item.entityId}` : ""}
                    </p>
                    <pre className="mt-2 overflow-auto rounded bg-slate-950/70 p-2 text-[11px]">
                      {JSON.stringify(item.details, null, 2)}
                    </pre>
                  </section>
                ))
              )}
            </div>
          </article>
        ) : null}
      </div>
    </main>
  );
}


