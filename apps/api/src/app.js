import express from "express";
import compression from "compression";
import cors from "cors";
import cookieParser from "cookie-parser";
import multer from "multer";
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AdminEventSettingsUpdateSchema,
  AdminPuzzleCreateSchema,
  AdminHintUpdateSchema,
  AdminPuzzleMetadataUpdateSchema,
  AdminPuzzlePenaltyUpdateSchema,
  AdminPuzzleToolConfigUpdateSchema,
  ClipboardCreateRequestSchema,
  ClipboardResponseSchema,
  EventStateResponseSchema,
  HintRevealResponseSchema,
  HintTierSchema,
  LifelineActivateRequestSchema,
  LifelinePuzzleSwitchRequestSchema,
  NotepadResponseSchema,
  NotepadUpsertRequestSchema,
  ProgressResponseSchema,
  PuzzleDetailResponseSchema,
  PuzzleListResponseSchema,
  PuzzleSubmitRequestSchema,
  PuzzleSubmitResponseSchema,
  PuzzleToolConfigSchema,
  TeamSessionRequestSchema,
  TeamSessionResponseSchema
} from "@puzzle-platform/contracts";
import { issueTeamSession, requireAdmin, requireTeamSession } from "./auth.js";
import { deriveRemainingSeconds, normalizeAnswer } from "./time.js";

const SUBMISSION_LOCKS = new Set();
const TEAM_PUZZLE_COUNT = 10;
const TEAM_POOL_MAX_ATTEMPTS = 500;
const MIN_EVENT_PUZZLE_COUNT = 20;
const MAX_EVENT_PUZZLE_COUNT = 26;
const PUBLIC_STREAM_TICK_MS = 3000;
const ADMIN_ASSET_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const CODE_CHECKER_FILE_TOKENS = ["solution", "organizer_solution", "verifier", "correct", "answer"];

const adminAssetUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: ADMIN_ASSET_UPLOAD_MAX_BYTES,
    files: 20
  }
});

function parseBody(schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      ok: false,
      status: 400,
      message: issue?.message || "Invalid request payload."
    };
  }

  return {
    ok: true,
    data: result.data
  };
}

function extractAssetFilePathFromUrl(rawUrl) {
  const value = `${rawUrl || ""}`.trim();
  if (!value) {
    return null;
  }

  try {
    const parsedUrl = new URL(value, "http://local.puzzle");
    if (!parsedUrl.pathname.startsWith("/puzzle-assets/")) {
      return null;
    }

    const file = parsedUrl.searchParams.get("file");
    return file ? decodeURIComponent(file) : null;
  } catch {
    return null;
  }
}

function filterExternalLinksForViewer(externalLinks, { viewerTeamId = null, isAdmin = false } = {}) {
  if (!Array.isArray(externalLinks)) {
    return [];
  }

  return externalLinks.filter((link) => {
    const assetRelativePath = extractAssetFilePathFromUrl(link?.url);
    if (!assetRelativePath) {
      return true;
    }

    return (isAdmin || isParticipantVisibleAsset(assetRelativePath)) && canTeamViewAsset(assetRelativePath, { viewerTeamId, isAdmin });
  });
}

function mapToolConfig(puzzle, { viewerTeamId = null, isAdmin = false } = {}) {
  return PuzzleToolConfigSchema.parse({
    builtinUtils: puzzle.builtinUtils,
    externalLinks: filterExternalLinksForViewer(puzzle.externalLinks, {
      viewerTeamId,
      isAdmin
    }),
    isInspectPuzzle: puzzle.isInspectPuzzle,
    isolatedUrl: puzzle.isolatedUrl
  });
}

async function getActiveEvent(prisma) {
  const event = await prisma.event.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" }
  });
  
  return event;
}

function hintPenaltyPointsForTier(tier) {
  if (tier === "tier2") {
    return 1;
  }

  if (tier === "tier3") {
    return 2;
  }

  return 0;
}

function sumHintPenaltyPoints(revealRows) {
  if (!Array.isArray(revealRows)) {
    return 0;
  }

  return revealRows.reduce((total, row) => {
    if (row?.tier) {
      return total + hintPenaltyPointsForTier(row.tier);
    }

    return total + Number(row?.penaltySeconds || 0);
  }, 0);
}

async function getTeamPenaltyPoints(prisma, teamId) {
  const reveals = await prisma.hintRevealAudit.findMany({
    where: { teamId },
    select: {
      tier: true,
      penaltySeconds: true
    }
  });

  return sumHintPenaltyPoints(reveals);
}

function getCompetitionNow(event) {
  if (event?.isPaused && event?.pausedAt) {
    return new Date(event.pausedAt);
  }

  return new Date();
}

function shouldUseSecureCookie(req, config) {
  if (!config.isProduction) {
    return false;
  }

  const forwardedProto = `${req.headers?.["x-forwarded-proto"] || ""}`
    .split(",")[0]
    .trim()
    .toLowerCase();

  return Boolean(req.secure) || forwardedProto === "https";
}

function normalizeOrigin(value) {
  try {
    return new URL(`${value}`).origin;
  } catch {
    return null;
  }
}

function getAllowedCorsOrigins(config) {
  const configured = normalizeOrigin(config.WEB_ORIGIN);
  const allowed = new Set();

  if (configured) {
    allowed.add(configured);
  }

  if (!config.isProduction) {
    const localHosts = ["localhost", "127.0.0.1"];
    const localPorts = ["5173", "5174"];

    for (const host of localHosts) {
      for (const port of localPorts) {
        allowed.add(`http://${host}:${port}`);
      }
    }
  }

  return allowed;
}

function statusForPuzzle({ puzzleId, solvedSet, attemptedSet }) {
  if (solvedSet.has(puzzleId)) {
    return "solved";
  }

  if (attemptedSet.has(puzzleId)) {
    return "attempted";
  }

  return "unsolved";
}

function sortHintsByTier(hints) {
  const priority = { tier1: 1, tier2: 2, tier3: 3 };
  return [...hints].sort((a, b) => (priority[a.tier] || 99) - (priority[b.tier] || 99));
}

function shuffleIds(ids) {
  const next = [...ids];
  for (let idx = next.length - 1; idx > 0; idx -= 1) {
    const swapIdx = randomInt(idx + 1);
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
  }
  return next;
}

function chooseCount(n, k) {
  if (k < 0 || k > n) {
    return 0n;
  }

  const reduced = Math.min(k, n - k);
  let result = 1n;
  for (let index = 1; index <= reduced; index += 1) {
    result = (result * BigInt(n - reduced + index)) / BigInt(index);
  }

  return result;
}

function poolSignature(order) {
  return [...order].sort().join("|");
}

function normalizeOrder(rawOrder, validIds) {
  const validSet = new Set(validIds);
  if (!Array.isArray(rawOrder)) {
    return [];
  }

  return rawOrder
    .map((value) => `${value}`)
    .filter((value, index, all) => validSet.has(value) && all.indexOf(value) === index);
}

function normalizeTeamPool(rawOrder, validIds) {
  return normalizeOrder(rawOrder, validIds).slice(0, TEAM_PUZZLE_COUNT);
}

function generateUniqueTeamPuzzleOrder(validIds, blockedSignatures) {
  if (validIds.length < TEAM_PUZZLE_COUNT) {
    // During manual build-up there may be fewer than the pool target; use all available for now.
    return shuffleIds(validIds).slice(0, TEAM_PUZZLE_COUNT);
  }

  const totalPools = chooseCount(validIds.length, TEAM_PUZZLE_COUNT);
  if (BigInt(blockedSignatures.size) >= totalPools) {
    throw new Error("Unable to assign a unique puzzle pool. Add more puzzles to increase combinations.");
  }

  for (let attempt = 0; attempt < TEAM_POOL_MAX_ATTEMPTS; attempt += 1) {
    const candidate = shuffleIds(validIds).slice(0, TEAM_PUZZLE_COUNT);
    const signature = poolSignature(candidate);
    if (!blockedSignatures.has(signature)) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique team puzzle pool after multiple attempts.");
}

function generateTemporaryTeamPuzzleOrder(validIds) {
  if (validIds.length < TEAM_PUZZLE_COUNT) {
    // Temporary pools should still be created while puzzle count is below the target size.
    return shuffleIds(validIds).slice(0, TEAM_PUZZLE_COUNT);
  }

  return shuffleIds(validIds).slice(0, TEAM_PUZZLE_COUNT);
}

async function assignTeamPuzzleSet(prisma, { teamId, eventId, forceRegenerate = false, temporary = false }) {
  const eventPuzzles = await prisma.puzzle.findMany({
    where: { eventId },
    orderBy: { orderIndex: "asc" },
    select: { id: true }
  });
  const validIds = eventPuzzles.map((row) => row.id);
  const expectedPoolSize = Math.min(TEAM_PUZZLE_COUNT, validIds.length);

  const allSets = await prisma.teamPuzzleSet.findMany({
    where: { eventId },
    select: {
      id: true,
      teamId: true,
      puzzleOrder: true
    }
  });

  const existing = allSets.find((row) => row.teamId === teamId) || null;
  const blockedSignatures = temporary
    ? new Set()
    : new Set(
        allSets
          .filter((row) => row.teamId !== teamId)
          .map((row) => normalizeTeamPool(row.puzzleOrder, validIds))
          .filter((pool) => pool.length === TEAM_PUZZLE_COUNT)
          .map((pool) => poolSignature(pool))
      );

  const nextOrder = temporary
    ? generateTemporaryTeamPuzzleOrder(validIds)
    : generateUniqueTeamPuzzleOrder(validIds, blockedSignatures);

  if (!existing) {
    return prisma.teamPuzzleSet.create({
      data: {
        teamId,
        eventId,
        puzzleOrder: nextOrder
      }
    });
  }

  const preserved = normalizeTeamPool(existing.puzzleOrder, validIds);
  const isValidCurrentPool = !forceRegenerate && preserved.length === expectedPoolSize;

  if (isValidCurrentPool) {
    return existing;
  }

  return prisma.teamPuzzleSet.update({
    where: { id: existing.id },
    data: { puzzleOrder: nextOrder }
  });
}

async function ensureTeamPuzzleSet(prisma, { teamId, eventId }) {
  try {
    return await assignTeamPuzzleSet(prisma, {
      teamId,
      eventId,
      forceRegenerate: false,
      temporary: false
    });
  } catch (error) {
    const canFallback = `${error?.message || ""}`.includes("Unable to assign a unique puzzle pool");
    if (!canFallback) {
      throw error;
    }

    return assignTeamPuzzleSet(prisma, {
      teamId,
      eventId,
      forceRegenerate: true,
      temporary: true
    });
  }
}

async function getTeamPuzzleOrder(prisma, { teamId, eventId }) {
  const event = await prisma.event.findFirst({
    where: {
      id: eventId
    }
  });

  if (!event || !eventHasStarted(event)) {
    return [];
  }

  const [eventPuzzles, teamSet] = await Promise.all([
    prisma.puzzle.findMany({
      where: { eventId },
      orderBy: { orderIndex: "asc" },
      select: { id: true }
    }),
    prisma.teamPuzzleSet.findUnique({
      where: {
        teamId_eventId: {
          teamId,
          eventId
        }
      }
    })
  ]);

  const orderedPuzzleIds = getOrderedPuzzleIds(eventPuzzles);
  const frozenPuzzleIds = getFrozenPuzzleIds(event, orderedPuzzleIds);
  return normalizeOrder(teamSet?.puzzleOrder, frozenPuzzleIds).slice(0, frozenPuzzleIds.length);
}

async function addPuzzleToTeamPool(prisma, { teamId, eventId, puzzleId }) {
  const eventPuzzles = await prisma.puzzle.findMany({
    where: { eventId },
    orderBy: { orderIndex: "asc" },
    select: { id: true }
  });
  const validIds = eventPuzzles.map((row) => row.id);
  if (!validIds.includes(puzzleId)) {
    throw new Error("Puzzle is not part of the active event.");
  }

  let teamSet;
  try {
    teamSet = await ensureTeamPuzzleSet(prisma, { teamId, eventId });
  } catch (error) {
    const canFallback = `${error?.message || ""}`.includes("Unable to assign a unique puzzle pool");
    if (!canFallback) {
      throw error;
    }

    teamSet = await assignTeamPuzzleSet(prisma, {
      teamId,
      eventId,
      forceRegenerate: true,
      temporary: true
    });
  }

  const normalizedOrder = normalizeOrder(teamSet.puzzleOrder, validIds);
  let nextOrder = [puzzleId, ...normalizedOrder.filter((id) => id !== puzzleId)];

  if (nextOrder.length < TEAM_PUZZLE_COUNT) {
    const fillers = shuffleIds(validIds.filter((id) => !nextOrder.includes(id)));
    nextOrder = [...nextOrder, ...fillers];
  }

  nextOrder = nextOrder.slice(0, TEAM_PUZZLE_COUNT);

  return prisma.teamPuzzleSet.update({
    where: { id: teamSet.id },
    data: { puzzleOrder: nextOrder }
  });
}

async function removePuzzleFromTeamPool(prisma, { teamId, eventId, puzzleId }) {
  const eventPuzzles = await prisma.puzzle.findMany({
    where: { eventId },
    orderBy: { orderIndex: "asc" },
    select: { id: true }
  });
  const validIds = eventPuzzles.map((row) => row.id);
  if (!validIds.includes(puzzleId)) {
    throw new Error("Puzzle is not part of the active event.");
  }

  let teamSet;
  try {
    teamSet = await ensureTeamPuzzleSet(prisma, { teamId, eventId });
  } catch (error) {
    const canFallback = `${error?.message || ""}`.includes("Unable to assign a unique puzzle pool");
    if (!canFallback) {
      throw error;
    }

    teamSet = await assignTeamPuzzleSet(prisma, {
      teamId,
      eventId,
      forceRegenerate: true,
      temporary: true
    });
  }

  const normalizedOrder = normalizeOrder(teamSet.puzzleOrder, validIds);
  const nextOrder = normalizedOrder.filter((id) => id !== puzzleId);
  const targetCount = Math.min(TEAM_PUZZLE_COUNT, Math.max(validIds.length - 1, 0));

  if (nextOrder.length < targetCount) {
    const fillers = shuffleIds(validIds.filter((id) => id !== puzzleId && !nextOrder.includes(id)));
    nextOrder.push(...fillers.slice(0, targetCount - nextOrder.length));
  }

  return prisma.teamPuzzleSet.update({
    where: { id: teamSet.id },
    data: { puzzleOrder: nextOrder.slice(0, TEAM_PUZZLE_COUNT) }
  });
}

async function getTeamPuzzleState(prisma, { teamId, event }) {
  if (!eventHasStarted(event)) {
    return {
      teamSet: null,
      order: [],
      currentPuzzleIndex: 0,
      currentPuzzleId: null,
      isStarted: false,
      isFinished: false
    };
  }

  const [eventPuzzles, teamSet] = await Promise.all([
    prisma.puzzle.findMany({
      where: { eventId: event.id },
      orderBy: { orderIndex: "asc" },
      select: { id: true }
    }),
    prisma.teamPuzzleSet.findUnique({
      where: {
        teamId_eventId: {
          teamId,
          eventId: event.id
        }
      }
    })
  ]);

  const orderedPuzzleIds = getOrderedPuzzleIds(eventPuzzles);
  const frozenPuzzleIds = getFrozenPuzzleIds(event, orderedPuzzleIds);
  const order = normalizeOrder(teamSet?.puzzleOrder, frozenPuzzleIds).slice(0, frozenPuzzleIds.length);
  const currentPuzzleIndex = normalizeCurrentPuzzleIndex(teamSet?.currentPuzzleIndex, order.length);
  const isFinished = order.length > 0 && currentPuzzleIndex >= order.length;
  const currentPuzzleId = isFinished ? null : order[currentPuzzleIndex] || null;

  return {
    teamSet,
    order,
    currentPuzzleIndex,
    currentPuzzleId,
    isStarted: true,
    isFinished
  };
}

async function getAssignedPuzzle(prisma, { teamId, eventId, identifier, includeHints = false, isAdmin = false }) {
  const event = await prisma.event.findFirst({
    where: {
      id: eventId
    }
  });

  const [state, puzzle] = await Promise.all([
    isAdmin
      ? prisma.puzzle
          .findMany({
            where: { eventId },
            orderBy: { orderIndex: "asc" },
            select: { id: true }
          })
          .then((rows) => ({
            teamSet: null,
            order: getOrderedPuzzleIds(rows),
            currentPuzzleIndex: 0,
            currentPuzzleId: null,
            isStarted: true,
            isFinished: false
          }))
      : getTeamPuzzleState(prisma, { teamId, event }),
    prisma.puzzle.findFirst({
      where: {
        eventId,
        OR: [{ id: identifier }, { slug: identifier }]
      },
      include: includeHints ? { hints: true } : undefined
    })
  ]);

  if (!puzzle || (!isAdmin && !state.order.includes(puzzle.id))) {
    return { puzzle: null, ...state, teamOrderIndex: -1 };
  }

  return {
    puzzle,
    ...state,
    teamOrderIndex: state.order.indexOf(puzzle.id)
  };
}

function buildAccessiblePuzzleSet(currentPuzzleId) {
  return new Set(currentPuzzleId ? [currentPuzzleId] : []);
}

async function teamCanAccessPuzzle(_prisma, { puzzleId, currentPuzzleId, order = [], isAdmin = false }) {
  if (isAdmin) {
    return true;
  }

  if (currentPuzzleId) {
    return currentPuzzleId === puzzleId;
  }

  return false;
}

async function teamCanAdvance(prisma, { teamId, currentPuzzleId, event }) {
  if (!currentPuzzleId || !event || !eventHasStarted(event) || getCompetitionSnapshot(event).isTimeUp) {
    return false;
  }

  const solve = await prisma.puzzleSolve.findUnique({
    where: {
      teamId_puzzleId: {
        teamId,
        puzzleId: currentPuzzleId
      }
    }
  });

  return Boolean(solve);
}

async function teamCanSkip(prisma, { teamId, currentPuzzleId, event }) {
  if (!currentPuzzleId || !event || !eventHasStarted(event) || getCompetitionSnapshot(event).isTimeUp) {
    return false;
  }

  const solve = await prisma.puzzleSolve.findUnique({
    where: {
      teamId_puzzleId: {
        teamId,
        puzzleId: currentPuzzleId
      }
    }
  });

  return !Boolean(solve);
}

async function getTeamTargetedPuzzleIdsFromAudit(prisma, { teamId, poolPuzzleIds, slugToId }) {
  if (!teamId || !Array.isArray(poolPuzzleIds) || poolPuzzleIds.length === 0) {
    return new Set();
  }

  const rows = await prisma.adminAuditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 2000
  });

  const poolSet = new Set(poolPuzzleIds.map((id) => `${id}`));
  const targeted = new Set();

  for (const row of rows) {
    if (row.action !== "create_puzzle_manual") {
      continue;
    }

    const details = row.details && typeof row.details === "object" ? row.details : null;
    if (!details) {
      continue;
    }

    if (`${details.targetTeamId || ""}` !== `${teamId}`) {
      continue;
    }

    const entityId = `${row.entityId || ""}`.trim();
    if (entityId && poolSet.has(entityId)) {
      targeted.add(entityId);
      continue;
    }

    const slug = `${details.slug || ""}`.trim();
    if (!slug) {
      continue;
    }

    const mappedId = slugToId.get(slug);
    if (mappedId && poolSet.has(mappedId)) {
      targeted.add(mappedId);
    }
  }

  return targeted;
}

function trimProcessOutput(value, maxLength = 20000) {
  const text = `${value || ""}`;
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...[truncated]` : text;
}

async function executeInterpreterProcess({ command, args, stdin = "", timeoutMs = 4000 }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = trimProcessOutput(stdout + `${chunk}`);
    });

    child.stderr.on("data", (chunk) => {
      stderr = trimProcessOutput(stderr + `${chunk}`);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        ok: false,
        error: error.message,
        stdout,
        stderr,
        timedOut,
        exitCode: null
      });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({
        ok: true,
        stdout,
        stderr,
        timedOut,
        exitCode: typeof code === "number" ? code : null
      });
    });

    if (stdin) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

async function runCodeSnippet({ language, code, stdin }) {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-code-"));

  try {
    if (language === "javascript") {
      const jsFile = path.join(scratchDir, "snippet.mjs");
      fs.writeFileSync(jsFile, code, "utf8");
      return executeInterpreterProcess({
        command: process.execPath,
        args: [jsFile],
        stdin
      });
    }

    const pyFile = path.join(scratchDir, "snippet.py");
    fs.writeFileSync(pyFile, code, "utf8");

    const candidates = process.platform === "win32"
      ? [
          { command: "py", args: ["-3", pyFile] },
          { command: "python", args: [pyFile] }
        ]
      : [
          { command: "python3", args: [pyFile] },
          { command: "python", args: [pyFile] }
        ];

    let lastError = null;
    for (const candidate of candidates) {
      const result = await executeInterpreterProcess({
        command: candidate.command,
        args: candidate.args,
        stdin
      });

      if (result.ok) {
        return result;
      }

      lastError = result;
      if (!`${result.error || ""}`.includes("ENOENT")) {
        return result;
      }
    }

    return {
      ok: false,
      error: "Python runtime is not available on this server.",
      stdout: "",
      stderr: lastError?.stderr || "",
      timedOut: false,
      exitCode: null
    };
  } finally {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

async function runCodeFile({ language, filePath, stdin }) {
  if (language === "javascript") {
    return executeInterpreterProcess({
      command: process.execPath,
      args: [filePath],
      stdin
    });
  }

  const candidates = process.platform === "win32"
    ? [
        { command: "py", args: ["-3", filePath] },
        { command: "python", args: [filePath] }
      ]
    : [
        { command: "python3", args: [filePath] },
        { command: "python", args: [filePath] }
      ];

  let lastError = null;
  for (const candidate of candidates) {
    const result = await executeInterpreterProcess({
      command: candidate.command,
      args: candidate.args,
      stdin
    });

    if (result.ok) {
      return result;
    }

    lastError = result;
    if (!`${result.error || ""}`.includes("ENOENT")) {
      return result;
    }
  }

  return {
    ok: false,
    error: "Python runtime is not available on this server.",
    stdout: "",
    stderr: lastError?.stderr || "",
    timedOut: false,
    exitCode: null
  };
}

function findValidationCodeFile(slug, language) {
  const puzzleDir = resolveImportedPuzzleDir(slug);
  if (!puzzleDir || !fs.existsSync(puzzleDir)) {
    return null;
  }

  const files = [];
  walkAssetFiles(puzzleDir, puzzleDir, files, 500);
  const allowedExtensions = language === "javascript" ? new Set([".js", ".mjs", ".cjs"]) : new Set([".py"]);

  const candidates = files.filter((relativePath) => {
    const extension = path.extname(relativePath).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return false;
    }

    const fileName = path.basename(relativePath).toLowerCase();
    return CODE_CHECKER_FILE_TOKENS.some((token) => fileName.includes(token));
  });

  if (candidates.length === 0) {
    return null;
  }

  const prioritize = (relativePath) => {
    const fileName = path.basename(relativePath).toLowerCase();
    if (fileName.includes("organizer_solution")) return 1;
    if (fileName.includes("solution")) return 2;
    if (fileName.includes("verifier")) return 3;
    if (fileName.includes("correct")) return 4;
    if (fileName.includes("answer")) return 5;
    return 99;
  };

  const selected = [...candidates].sort((left, right) => prioritize(left) - prioritize(right))[0];
  return path.join(puzzleDir, ...selected.split("/"));
}

function enforcementPayloadForTeam(team, config, lifeline = null) {
  const nowMs = Date.now();
  const lifelineActive = Boolean(lifeline?.expiresAtMs && lifeline.expiresAtMs > nowMs);
  const lifelineRemainingSeconds = lifelineActive
    ? Math.max(0, Math.ceil((lifeline.expiresAtMs - nowMs) / 1000))
    : 0;

  return {
    warnings: Number(team?.warningCount || 0),
    maxWarnings: Number(config.MAX_WARNINGS || 3),
    isLocked: lifelineActive ? false : Boolean(team?.isLocked),
    lockedAt: team?.lockedAt ? new Date(team.lockedAt).toISOString() : null,
    isBanned: Boolean(team?.isBanned),
    bannedAt: team?.bannedAt ? new Date(team.bannedAt).toISOString() : null,
    lifelineActive,
    lifelineExpiresAt: lifelineActive ? new Date(lifeline.expiresAtMs).toISOString() : null,
    lifelineRemainingSeconds,
    lifelinePuzzleId: lifelineActive ? lifeline.puzzleId : null,
    lifelinesRemaining: Math.max(0, 2 - (team?.lifelinesUsed || 0))
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const puzzleBankFile = path.resolve(__dirname, "../puzzle_bank/puzzles.json");
const importedPuzzleRoot = path.resolve(__dirname, "../puzzle_bank/imported");
const manualUploadCollectionDir = path.join(importedPuzzleRoot, "manual_uploads");
const DEFAULT_EXTERNAL_PUZZLE_COLLECTIONS = [
  "D:/New folder/ALL_PUZZLE_COMBINED/NEW ALL PUZZLE/NEW ALL PUZZLE"
];
const CONFIGURED_EXTERNAL_PUZZLE_COLLECTIONS = `${process.env.PUZZLE_COLLECTION_PATHS || ""}`
  .split(/[;\n]/g)
  .map((item) => `${item || ""}`.trim())
  .filter(Boolean);

const IMPORTED_FOLDER_ALIASES = {
  "http-error-chain": "404_intentional_error_puzzle",
  "ascii-numeric-sample": "ascii_numeric_sample",
  "audio-morse-sample": "audio_morse_sample",
  "book-cipher-puzzle": "book_cipher_puzzle",
  "fix-errors-organizer-pack": "fix_errors_organizer_pack",
  "fix-errors-participant-pack": "fix_errors_participant_pack",
  "html-inspect-sample": "html_inspect_sample",
  "image-cipher": "ImageCipher",
  "maze-300-moves": "maze_300_moves/maze-puzzle(1)",
  "progressive-caesar-1": "progressive_caesar_sample/puzzle_1",
  "progressive-caesar-2": "progressive_caesar_sample/puzzle_2",
  "simple-reverse-text": "SimpleReverseText_Puzzle",
  "time-based-otp": "TimeBasedOTP_Puzzle"
};

const ASSET_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".pdf",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".csv",
  ".html",
  ".js",
  ".css",
  ".py",
  ".zip",
  ".wav",
  ".mp3",
  ".ogg",
  ".m4a",
  ".mp4",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bin"
]);
const TEAM_PRIVATE_ASSET_FOLDER = "__team_private__";

const SENSITIVE_ASSET_TOKENS = [
  "solution",
  "organizer",
  "answer",
  "verifier",
  "secret",
  "plaintext",
  "master_readme"
];

function readPuzzleBank() {
  const raw = fs.readFileSync(puzzleBankFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Puzzle bank must be a non-empty JSON array.");
  }

  return parsed;
}

function normalizeToken(value) {
  return `${value || ""}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizePuzzleTypeKey(value) {
  return `${value || ""}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getConfiguredPuzzleCount(event) {
  const requested = Number.parseInt(`${event?.puzzleCount ?? MIN_EVENT_PUZZLE_COUNT}`, 10);
  if (Number.isNaN(requested)) {
    return MIN_EVENT_PUZZLE_COUNT;
  }

  return Math.max(MIN_EVENT_PUZZLE_COUNT, Math.min(MAX_EVENT_PUZZLE_COUNT, requested));
}

function eventHasStarted(event) {
  return Boolean(event?.startedAt);
}

function getOrderedPuzzleIds(rows) {
  return rows.map((row) => `${row.id}`);
}

function getFrozenPuzzleIds(event, orderedPuzzleIds) {
  const frozenOrder = normalizeOrder(event?.frozenPuzzleIds, orderedPuzzleIds);
  const targetCount = Math.min(getConfiguredPuzzleCount(event), orderedPuzzleIds.length);
  if (frozenOrder.length >= targetCount) {
    return frozenOrder.slice(0, targetCount);
  }

  return orderedPuzzleIds.slice(0, targetCount);
}

function normalizeCurrentPuzzleIndex(rawValue, orderLength) {
  const parsed = Number.parseInt(`${rawValue ?? 0}`, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0;
  }

  return Math.min(parsed, orderLength);
}

function orderSignature(order) {
  return order.join("|");
}

function generateUniqueTeamOrder(validIds, blockedSignatures) {
  if (validIds.length <= 1) {
    return [...validIds];
  }

  for (let attempt = 0; attempt < TEAM_POOL_MAX_ATTEMPTS; attempt += 1) {
    const candidate = shuffleIds(validIds);
    const signature = orderSignature(candidate);
    if (!blockedSignatures.has(signature)) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique team puzzle order after multiple attempts.");
}

const PUZZLE_POINTS = {
  "image cipher": 2,
  "html inspect": 2,
  "ascii art puzzle": 2,
  "audio cipher": 3,
  "progressive caesar cipher": 3,
  "time-based otp": 1,
  "book cipher": 2,
  "reverse text puzzle": 1,
  "fix the errors": 2,
  "print statement maze": 2
};

function getPuzzlePoints(title) {
  if (!title) return 1;
  const lower = title.toLowerCase();
  for (const [key, val] of Object.entries(PUZZLE_POINTS)) {
    if (lower.includes(key)) return val;
  }
  return 1;
}

function getLastSolvedAt(solveRows) {
  return solveRows.reduce((latest, row) => {
    if (!row?.solvedAt) {
      return latest;
    }

    const current = row.solvedAt instanceof Date ? row.solvedAt : new Date(row.solvedAt);
    if (!latest || current.getTime() > latest.getTime()) {
      return current;
    }

    return latest;
  }, null);
}

async function buildLeaderboardRows(prisma, event) {
  const teams = await prisma.team.findMany({
    orderBy: { name: "asc" }
  });

  const participantTeams = teams.filter((team) => !team.isAdmin);
  const startedAtMs = event?.startsAt ? new Date(event.startsAt).getTime() : null;

  const [allSolves, allReveals, allPuzzles] = await Promise.all([
    prisma.puzzleSolve.findMany(),
    prisma.hintRevealAudit.findMany(),
    prisma.puzzle.findMany({ select: { id: true, title: true } })
  ]);

  const pointsById = new Map();
  for (const p of allPuzzles) {
    pointsById.set(p.id, getPuzzlePoints(p.title));
  }

  const solvesByTeamId = new Map();
  for (const solve of allSolves) {
    if (!solvesByTeamId.has(solve.teamId)) {
      solvesByTeamId.set(solve.teamId, []);
    }
    solvesByTeamId.get(solve.teamId).push(solve);
  }

  const revealsByTeamId = new Map();
  for (const reveal of allReveals) {
    if (!revealsByTeamId.has(reveal.teamId)) {
      revealsByTeamId.set(reveal.teamId, []);
    }
    revealsByTeamId.get(reveal.teamId).push(reveal);
  }

  const rows = participantTeams.map((team) => {
    const solveRows = solvesByTeamId.get(team.id) || [];
    const revealRows = revealsByTeamId.get(team.id) || [];
    const hintPenaltyPoints = sumHintPenaltyPoints(revealRows);

    let points = 0;
    for (const solve of solveRows) {
      points += pointsById.get(solve.puzzleId) || 1;
    }

    const lastSolvedAt = getLastSolvedAt(solveRows);
    const totalElapsedSeconds =
      lastSolvedAt && startedAtMs !== null
        ? Math.max(0, Math.floor((lastSolvedAt.getTime() - startedAtMs) / 1000))
        : null;

    return {
      team: {
        id: team.id,
        code: team.code,
        name: team.name
      },
      points,
      hintPenaltyPoints,
      totalElapsedSeconds,
      lastCorrectAt: lastSolvedAt ? lastSolvedAt.toISOString() : null
    };
  });

  rows.sort((left, right) => {
    if (right.points !== left.points) {
      return right.points - left.points;
    }

    if (left.hintPenaltyPoints !== right.hintPenaltyPoints) {
      return left.hintPenaltyPoints - right.hintPenaltyPoints;
    }

    const leftElapsed = left.totalElapsedSeconds ?? Number.POSITIVE_INFINITY;
    const rightElapsed = right.totalElapsedSeconds ?? Number.POSITIVE_INFINITY;
    if (leftElapsed !== rightElapsed) {
      return leftElapsed - rightElapsed;
    }

    return left.team.name.localeCompare(right.team.name);
  });

  return rows.map((row, index) => ({
    rank: index + 1,
    ...row
  }));
}

function inferAssetRole(relativePath) {
  const normalized = `${relativePath || ""}`.replace(/\\/g, "/").toLowerCase();
  const parsed = parseTeamPrivateAssetPath(normalized);
  const fileName = path.basename(parsed.displayRelativePath || normalized);
  const fileStem = path.basename(fileName, path.extname(fileName));

  if (fileName.startsWith("solution-")) {
    return "solution";
  }

  if (fileName.startsWith("reference-")) {
    return "reference";
  }

  if (fileStem.startsWith("answer_template")) {
    return "reference";
  }

  if (CODE_CHECKER_FILE_TOKENS.some((token) => fileStem.startsWith(token))) {
    return "solution";
  }

  return "regular";
}

function hasStandaloneAssetToken(normalizedPath, token) {
  const escaped = `${token || ""}`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escaped) {
    return false;
  }

  const pattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`);
  return pattern.test(normalizedPath);
}

function isParticipantVisibleAsset(relativePath) {
  const normalized = `${relativePath || ""}`.replace(/\\/g, "/").toLowerCase();
  const role = inferAssetRole(normalized);

  if (role === "solution") {
    return false;
  }

  if (role === "reference") {
    return true;
  }

  if (normalized.includes("answer_template")) {
    return true;
  }

  // "no_solution" assets are participant-facing challenge files, not answer files.
  if (hasStandaloneAssetToken(normalized, "no_solution") || hasStandaloneAssetToken(normalized, "nosolution")) {
    return true;
  }

  return !SENSITIVE_ASSET_TOKENS.some((token) => {
    if (token === "solution") {
      return hasStandaloneAssetToken(normalized, token);
    }

    return normalized.includes(token);
  });
}

function listDirectories(parentDir) {
  if (!fs.existsSync(parentDir)) {
    return [];
  }

  return fs
    .readdirSync(parentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parentDir, entry.name));
}

function listConfiguredCollectionRoots() {
  const rawRoots = [
    ...DEFAULT_EXTERNAL_PUZZLE_COLLECTIONS,
    ...CONFIGURED_EXTERNAL_PUZZLE_COLLECTIONS
  ];

  const deduped = [...new Set(rawRoots.map((item) => path.resolve(`${item}`)))];
  return deduped.filter((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
    } catch {
      return false;
    }
  });
}

function getReadableImportedCollectionDirs() {
  const sortByMtimeDesc = (paths) =>
    [...paths].sort((left, right) => {
      const leftTime = fs.statSync(left).mtimeMs;
      const rightTime = fs.statSync(right).mtimeMs;
      return rightTime - leftTime;
    });

  const localCollections = sortByMtimeDesc(listDirectories(importedPuzzleRoot).map((item) => path.resolve(item)));
  const localSet = new Set(localCollections);
  const externalCollections = sortByMtimeDesc(
    listConfiguredCollectionRoots().map((item) => path.resolve(item)).filter((item) => !localSet.has(item))
  );

  return [...localCollections, ...externalCollections];
}

function getLatestImportedCollectionDir() {
  const candidates = listDirectories(importedPuzzleRoot);
  if (candidates.length === 0) {
    return null;
  }

  const sorted = candidates.sort((left, right) => {
    const leftTime = fs.statSync(left).mtimeMs;
    const rightTime = fs.statSync(right).mtimeMs;
    return rightTime - leftTime;
  });

  return sorted[0];
}

function resolveImportedPuzzleDir(slug) {
  const collectionDirs = getReadableImportedCollectionDirs();
  if (collectionDirs.length === 0) {
    return null;
  }

  for (const collectionDir of collectionDirs) {
    const aliasName = IMPORTED_FOLDER_ALIASES[slug];
    if (aliasName) {
      const aliased = path.join(collectionDir, aliasName);
      if (fs.existsSync(aliased)) {
        return aliased;
      }
    }

    const directDir = path.join(collectionDir, slug);
    if (fs.existsSync(directDir)) {
      return directDir;
    }

    const dirs = listDirectories(collectionDir);
    if (dirs.length === 0) {
      continue;
    }

    const slugTokens = `${slug}`.toLowerCase().split(/[^a-z0-9]+/g).filter((token) => token.length > 2);
    if (slugTokens.length === 0) {
      continue;
    }

    let bestDir = null;
    let bestScore = 0;

    for (const dirPath of dirs) {
      const folderName = path.basename(dirPath).toLowerCase();
      let score = 0;
      for (const token of slugTokens) {
        if (folderName.includes(token)) {
          score += token.length;
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestDir = dirPath;
      }
    }

    if (bestScore > 0) {
      return bestDir;
    }
  }

  return null;
}

function sanitizeUploadedFileName(originalName) {
  const baseName = path.basename(`${originalName || ""}`).trim();
  const safeName = baseName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safeName || `asset-${Date.now()}`;
}

function extensionFromMimeType(mimeType) {
  const normalized = `${mimeType || ""}`.toLowerCase();
  if (normalized === "image/png") return ".png";
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/gif") return ".gif";
  if (normalized === "image/webp") return ".webp";
  if (normalized === "text/plain") return ".txt";
  if (normalized === "text/markdown") return ".md";
  if (normalized === "text/html") return ".html";
  if (normalized === "text/css") return ".css";
  if (normalized === "text/csv") return ".csv";
  if (normalized === "application/json") return ".json";
  if (normalized === "application/xml" || normalized === "text/xml") return ".xml";
  if (normalized === "application/javascript" || normalized === "text/javascript") return ".js";
  if (normalized === "application/pdf") return ".pdf";
  if (normalized === "application/zip") return ".zip";
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "audio/wav" || normalized === "audio/x-wav") return ".wav";
  if (normalized === "audio/mpeg") return ".mp3";
  if (normalized === "audio/ogg") return ".ogg";
  if (normalized === "audio/mp4" || normalized === "audio/x-m4a") return ".m4a";
  return "";
}

function getUploadExtension(file) {
  const safeName = sanitizeUploadedFileName(file?.originalname || "asset");
  const explicitExtension = path.extname(safeName).toLowerCase();
  return explicitExtension || extensionFromMimeType(file?.mimetype);
}

function isAllowedUploadFile(file) {
  const extension = getUploadExtension(file);
  return Boolean(extension) && ASSET_EXTENSIONS.has(extension);
}

function createStoredAssetFileName(file) {
  const safeName = sanitizeUploadedFileName(file?.originalname || "asset");
  const currentExtension = path.extname(safeName).toLowerCase();
  const extension = getUploadExtension(file);

  if (!extension || !ASSET_EXTENSIONS.has(extension)) {
    throw new Error("Unsupported file extension for uploaded asset.");
  }

  const stem = (currentExtension ? path.basename(safeName, currentExtension) : safeName).replace(/\.+$/, "") || "asset";
  const nonce = Math.random().toString(36).slice(2, 8);
  return `${Date.now()}-${nonce}-${stem}${extension}`;
}

function normalizeUploadRole(rawRole) {
  const role = `${rawRole || ""}`.trim().toLowerCase();
  if (role === "reference") {
    return "reference";
  }
  if (role === "solution") {
    return "solution";
  }
  return "regular";
}

function applyUploadRoleToFileName(fileName, uploadRole) {
  if (uploadRole === "reference" && !fileName.toLowerCase().startsWith("reference-")) {
    return `reference-${fileName}`;
  }

  if (uploadRole === "solution" && !fileName.toLowerCase().startsWith("solution-")) {
    return `solution-${fileName}`;
  }

  return fileName;
}

function resolveUploadPuzzleDir(slug) {
  const collectionDir = getLatestImportedCollectionDir() || manualUploadCollectionDir;
  fs.mkdirSync(collectionDir, { recursive: true });

  const aliasName = IMPORTED_FOLDER_ALIASES[slug];
  const relativeFolder = aliasName || slug;
  const puzzleDir = path.join(collectionDir, relativeFolder);
  fs.mkdirSync(puzzleDir, { recursive: true });

  return puzzleDir;
}

function inferAssetMediaType(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if ([".wav", ".mp3", ".ogg", ".m4a"].includes(extension)) {
    return "audio";
  }
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(extension)) {
    return "image";
  }
  if ([".html"].includes(extension)) {
    return "html";
  }
  return "file";
}

function parseTeamPrivateAssetPath(relativePath) {
  const normalized = `${relativePath || ""}`
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
  const prefix = `${TEAM_PRIVATE_ASSET_FOLDER}/`;

  if (!normalized.startsWith(prefix)) {
    return {
      isTeamPrivate: false,
      teamId: null,
      displayRelativePath: normalized
    };
  }

  const parts = normalized.split("/");
  if (parts.length < 3 || !parts[1]) {
    return {
      isTeamPrivate: true,
      teamId: null,
      displayRelativePath: ""
    };
  }

  return {
    isTeamPrivate: true,
    teamId: parts[1],
    displayRelativePath: parts.slice(2).join("/")
  };
}

function canTeamViewAsset(relativePath, { viewerTeamId = null, isAdmin = false } = {}) {
  const parsed = parseTeamPrivateAssetPath(relativePath);
  if (!parsed.isTeamPrivate) {
    return true;
  }

  if (isAdmin) {
    return true;
  }

  if (!parsed.teamId || !viewerTeamId) {
    return false;
  }

  return `${parsed.teamId}` === `${viewerTeamId}`;
}

function buildStoredAssetRelativePath(fileName, teamId = null) {
  if (!teamId) {
    return `${fileName}`;
  }

  return `${TEAM_PRIVATE_ASSET_FOLDER}/${teamId}/${fileName}`;
}

function isTeamPrivateAssetForViewer(relativePath, viewerTeamId) {
  const parsed = parseTeamPrivateAssetPath(relativePath);
  return parsed.isTeamPrivate && Boolean(viewerTeamId) && `${parsed.teamId}` === `${viewerTeamId}`;
}

function walkAssetFiles(baseDir, currentDir, items, maxItems = 200) {
  if (items.length >= maxItems) {
    return;
  }

  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (items.length >= maxItems) {
      break;
    }

    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      walkAssetFiles(baseDir, fullPath, items, maxItems);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!ASSET_EXTENSIONS.has(extension)) {
      continue;
    }

    const relative = path.relative(baseDir, fullPath).split(path.sep).join("/");
    items.push(relative);
  }
}

function listPuzzleAssets(slug, { viewerTeamId = null, isAdmin = false } = {}) {
  const puzzleDir = resolveImportedPuzzleDir(slug);
  if (!puzzleDir || !fs.existsSync(puzzleDir)) {
    return [];
  }

  const files = [];
  walkAssetFiles(puzzleDir, puzzleDir, files, 200);

  return files
    .filter((relativePath) => isAdmin || isParticipantVisibleAsset(relativePath))
    .filter((relativePath) => canTeamViewAsset(relativePath, { viewerTeamId, isAdmin }))
    .sort()
    .map((storedRelativePath) => {
      const parsed = parseTeamPrivateAssetPath(storedRelativePath);
      const displayRelativePath = parsed.displayRelativePath || storedRelativePath;
      const role = inferAssetRole(storedRelativePath);
      return {
        name: path.basename(displayRelativePath),
        relativePath: displayRelativePath,
        storedRelativePath,
        mediaType: inferAssetMediaType(displayRelativePath),
        role,
        visibility: parsed.isTeamPrivate ? "team" : "shared",
        url:
          role === "solution" && !isAdmin
            ? null
            : `/puzzle-assets/${encodeURIComponent(slug)}?file=${encodeURIComponent(storedRelativePath)}`
      };
    });
}

function resolvePuzzleAssetFile(slug, relativePath, { viewerTeamId = null, isAdmin = false, allowHidden = false } = {}) {
  const puzzleDir = resolveImportedPuzzleDir(slug);
  if (!puzzleDir || !relativePath) {
    return null;
  }

  const normalized = path.normalize(`${relativePath}`.replace(/\\/g, "/"));
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }

  const filePath = path.resolve(puzzleDir, normalized);
  if (!filePath.startsWith(path.resolve(puzzleDir))) {
    return null;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  const relative = path.relative(path.resolve(puzzleDir), filePath).split(path.sep).join("/");
  if (!allowHidden && !isParticipantVisibleAsset(relative)) {
    return null;
  }

  if (!canTeamViewAsset(relative, { viewerTeamId, isAdmin })) {
    return null;
  }

  const extension = path.extname(filePath).toLowerCase();
  if (!ASSET_EXTENSIONS.has(extension)) {
    return null;
  }

  return filePath;
}

function isPathInside(basePath, candidatePath) {
  const resolvedBase = path.resolve(basePath);
  const resolvedCandidate = path.resolve(candidatePath);
  const base = process.platform === "win32" ? resolvedBase.toLowerCase() : resolvedBase;
  const candidate = process.platform === "win32" ? resolvedCandidate.toLowerCase() : resolvedCandidate;

  if (candidate === base) {
    return true;
  }

  const normalizedBase = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  return candidate.startsWith(normalizedBase);
}

function resolvePuzzleAssetFileForAdmin(slug, relativePath) {
  const puzzleDir = resolveImportedPuzzleDir(slug);
  if (!puzzleDir || !relativePath) {
    return null;
  }

  const normalized = path.normalize(`${relativePath}`.replace(/\\/g, "/"));
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null;
  }

  const filePath = path.resolve(puzzleDir, normalized);
  if (!isPathInside(puzzleDir, filePath)) {
    return null;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  const extension = path.extname(filePath).toLowerCase();
  if (!ASSET_EXTENSIONS.has(extension)) {
    return null;
  }

  return filePath;
}

function removeEmptyParentDirectories(filePath, stopDir) {
  let current = path.dirname(filePath);
  while (isPathInside(stopDir, current) && path.resolve(current) !== path.resolve(stopDir)) {
    let entries = [];
    try {
      entries = fs.readdirSync(current);
    } catch {
      break;
    }

    if (entries.length > 0) {
      break;
    }

    fs.rmdirSync(current);
    current = path.dirname(current);
  }
}

function normalizeHintRowsForImport(puzzleId, hintRows) {
  const fallback = [
    { tier: "tier1", content: "Start with the visible clues." },
    { tier: "tier2", content: "Focus on recurring patterns." },
    { tier: "tier3", content: "Verify final format before submit." }
  ];
  const source = Array.isArray(hintRows) && hintRows.length > 0 ? hintRows : fallback;

  return source.map((hint) => ({
    puzzleId,
    tier: `${hint.tier}`,
    content: `${hint.content}`,
    penaltySeconds: hintPenaltyPointsForTier(`${hint.tier}`)
  }));
}

async function appendAdminAudit(prisma, { adminTeamId, action, entityType, entityId = null, details = null }) {
  await prisma.adminAuditLog.create({
    data: {
      adminTeamId,
      action,
      entityType,
      entityId,
      details
    }
  });
}

function getCompetitionSnapshot(event) {
  const now = getCompetitionNow(event);
  const remainingSeconds = deriveRemainingSeconds({
    now,
    eventEndsAt: event.endsAt,
    penaltiesSeconds: 0
  });

  return {
    now,
    remainingSeconds,
    isTimeUp: remainingSeconds <= 0
  };
}

function buildEventSummary(event) {
  return {
    id: event.id,
    name: event.name,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    startedAt: event.startedAt ? event.startedAt.toISOString() : null,
    isStarted: eventHasStarted(event),
    puzzleCount: getConfiguredPuzzleCount(event),
    frozenPuzzleCount: Array.isArray(event.frozenPuzzleIds) ? event.frozenPuzzleIds.length : 0
  };
}

function buildPublicEventStatePayload(event) {
  const competition = getCompetitionSnapshot(event);

  return {
    ok: true,
    event: buildEventSummary(event),
    competition: {
      isPaused: Boolean(event.isPaused),
      pausedAt: event.pausedAt ? event.pausedAt.toISOString() : null,
      isTimeUp: competition.isTimeUp
    },
    remainingSeconds: competition.remainingSeconds,
    now: competition.now.toISOString()
  };
}

export function createApp({ prisma, config }) {
  const app = express();
  app.use(compression());
  const allowedOrigins = getAllowedCorsOrigins(config);
  const activeLifelines = new Map();
  const publicStreamClients = new Set();
  let sseBroadcastDirty = true;
  let lastBroadcastJson = "";
  const leaderboardCacheTtlMs = Math.max(0, Number(config.LEADERBOARD_CACHE_TTL_MS || 3000));
  let leaderboardCache = null;

  const clearLeaderboardCache = () => {
    leaderboardCache = null;
  };

  const getCachedLeaderboard = async (event) => {
    const nowMs = Date.now();
    if (
      leaderboardCache &&
      leaderboardCache.eventId === event.id &&
      leaderboardCache.expiresAtMs > nowMs
    ) {
      return leaderboardCache;
    }

    const leaderboard = await buildLeaderboardRows(prisma, event);
    const next = {
      eventId: event.id,
      generatedAt: new Date(nowMs).toISOString(),
      expiresAtMs: nowMs + leaderboardCacheTtlMs,
      leaderboard
    };
    leaderboardCache = next;
    return next;
  };

  const writeSseEvent = (res, eventName, payload) => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const buildPublicRealtimeSnapshot = async () => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return {
        ok: true,
        eventState: null,
        generatedAt: new Date().toISOString(),
        leaderboard: []
      };
    }

    const leaderboard = await getCachedLeaderboard(event);
    return {
      ok: true,
      eventState: buildPublicEventStatePayload(event),
      generatedAt: leaderboard.generatedAt,
      leaderboard: leaderboard.leaderboard
    };
  };

  const markBroadcastDirty = () => { sseBroadcastDirty = true; };

  const broadcastPublicSnapshot = async () => {
    if (publicStreamClients.size === 0) {
      return;
    }

    const snapshot = await buildPublicRealtimeSnapshot();
    const json = JSON.stringify(snapshot);
    if (!sseBroadcastDirty && json === lastBroadcastJson) {
      return;
    }
    sseBroadcastDirty = false;
    lastBroadcastJson = json;
    for (const res of publicStreamClients) {
      writeSseEvent(res, "snapshot", snapshot);
    }
  };

  const publicStreamInterval = setInterval(() => {
    broadcastPublicSnapshot().catch(() => {});
  }, PUBLIC_STREAM_TICK_MS);
  publicStreamInterval.unref?.();

  const startEventAssignments = async (event, adminTeamId) => {
    if (eventHasStarted(event)) {
      throw new Error("Event has already started.");
    }

    const [orderedPuzzles, teams, existingSets] = await Promise.all([
      prisma.puzzle.findMany({
        where: { eventId: event.id },
        orderBy: { orderIndex: "asc" },
        select: { id: true }
      }),
      prisma.team.findMany({
        orderBy: { name: "asc" }
      }),
      prisma.teamPuzzleSet.findMany({
        where: { eventId: event.id },
        select: {
          id: true,
          teamId: true
        }
      })
    ]);

    const participantTeams = teams.filter((team) => !team.isAdmin);
    if (participantTeams.length === 0) {
      throw new Error("At least one participant team must exist before the event can start.");
    }

    const orderedPuzzleIds = getOrderedPuzzleIds(orderedPuzzles);
    const configuredPuzzleCount = getConfiguredPuzzleCount(event);
    if (orderedPuzzleIds.length < configuredPuzzleCount) {
      throw new Error(`At least ${configuredPuzzleCount} puzzles are required before starting the event.`);
    }

    const frozenPuzzleIds = orderedPuzzleIds.slice(0, configuredPuzzleCount);
    const usedOrderSignatures = new Set();
    const startedAt = new Date();
    const configuredDurationMs = Math.max(
      60_000,
      new Date(event.endsAt).getTime() - new Date(event.startsAt).getTime()
    );
    const nextEndsAt = new Date(startedAt.getTime() + configuredDurationMs);

    const startedEvent = await prisma.$transaction(async (tx) => {
      const updatedEvent = await tx.event.update({
        where: { id: event.id },
        data: {
          startedAt,
          startsAt: startedAt,
          endsAt: nextEndsAt,
          frozenPuzzleIds,
          isPaused: false,
          pausedAt: null
        }
      });

      for (const team of participantTeams) {
        const order = generateUniqueTeamOrder(frozenPuzzleIds, usedOrderSignatures);
        usedOrderSignatures.add(orderSignature(order));
        const existing = existingSets.find((row) => row.teamId === team.id) || null;

        if (existing) {
          await tx.teamPuzzleSet.update({
            where: { id: existing.id },
            data: {
              puzzleOrder: order,
              currentPuzzleIndex: 0
            }
          });
        } else {
          await tx.teamPuzzleSet.create({
            data: {
              teamId: team.id,
              eventId: event.id,
              puzzleOrder: order,
              currentPuzzleIndex: 0
            }
          });
        }
      }

      return updatedEvent;
    });

    await appendAdminAudit(prisma, {
      adminTeamId,
      action: "start_event",
      entityType: "event",
      entityId: startedEvent.id,
      details: {
        startedAt: startedAt.toISOString(),
        endsAt: nextEndsAt.toISOString(),
        puzzleCount: configuredPuzzleCount,
        teamCount: participantTeams.length
      }
    });

    clearLeaderboardCache();
    await broadcastPublicSnapshot();
    return startedEvent;
  };

  const getActiveLifeline = (teamId) => {
    if (!teamId) {
      return null;
    }

    const key = `${teamId}`;
    const existing = activeLifelines.get(key);
    if (!existing) {
      return null;
    }

    if (existing.expiresAtMs <= Date.now()) {
      activeLifelines.delete(key);
      return null;
    }

    return existing;
  };

  const clearLifeline = (teamId) => {
    if (!teamId) {
      return false;
    }

    return activeLifelines.delete(`${teamId}`);
  };

  const activateLifeline = ({ teamId, puzzleId }) => {
    const nowMs = Date.now();
    const next = {
      teamId: `${teamId}`,
      puzzleId: `${puzzleId}`,
      activatedAtMs: nowMs,
      expiresAtMs: nowMs + 31536000000 // 1 year (infinite for event duration)
    };
    activeLifelines.set(`${teamId}`, next);
    return next;
  };

  const switchLifelinePuzzle = ({ teamId, nextPuzzleId }) => {
    const active = getActiveLifeline(teamId);
    if (!active) {
      return { cleared: false, active: null };
    }

    if (!nextPuzzleId || `${nextPuzzleId}` !== `${active.puzzleId}`) {
      clearLifeline(teamId);
      return { cleared: true, active: null };
    }

    return { cleared: false, active };
  };

  const enforcementForTeam = (team) =>
    enforcementPayloadForTeam(team, config, getActiveLifeline(team?.id));

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) {
          return callback(null, true);
        }

        const normalized = normalizeOrigin(origin);
        if (normalized && allowedOrigins.has(normalized)) {
          return callback(null, true);
        }

        return callback(new Error("Origin is not allowed by CORS policy."));
      },
      credentials: true
    })
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser(config.SESSION_SECRET));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "puzzle-platform-api" });
  });

  app.get("/challenge/:slug", async (req, res) => {
    const slug = req.params.slug;
    const puzzle = await prisma.puzzle.findUnique({ where: { slug } });
    if (!puzzle?.isInspectPuzzle) {
      return res.status(404).send("Challenge page not found.");
    }

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${puzzle.title}</title>
    <style>
      body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0; background: #0d1117; color: #e6edf3; }
      main { max-width: 900px; margin: 0 auto; padding: 32px; }
      .box { border: 1px solid #30363d; border-radius: 12px; padding: 20px; background: #161b22; }
      .muted { color: #8b949e; }
    </style>
  </head>
  <body>
    <main>
      <h1>${puzzle.title}</h1>
      <p class="muted">No platform chrome route for inspect puzzles.</p>
      <section class="box">
        <p>${puzzle.prompt}</p>
        <!-- hidden-token: HIDDEN-NODE -->
        <span data-signal="encoded">U0NBTl9USEVfRE9NX1RSRUU=</span>
      </section>
    </main>
  </body>
</html>`;

    return res.type("html").send(html);
  });

  app.get("/public/event-state", async (_req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    return res.json(buildPublicEventStatePayload(event));
  });

  app.get("/leaderboard", async (_req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const snapshot = await getCachedLeaderboard(event);
    return res.json({
      ok: true,
      generatedAt: snapshot.generatedAt,
      leaderboard: snapshot.leaderboard
    });
  });

  app.get("/events/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    publicStreamClients.add(res);
    writeSseEvent(res, "snapshot", await buildPublicRealtimeSnapshot());

    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);
    keepAlive.unref?.();

    req.on("close", () => {
      clearInterval(keepAlive);
      publicStreamClients.delete(res);
      res.end();
    });
  });

  app.post("/auth/team-session", async (req, res) => {
    const parsed = parseBody(TeamSessionRequestSchema, req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, message: parsed.message });
    }

    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const normalizedCode = parsed.data.teamCode.trim().toUpperCase();
    const normalizedName = parsed.data.teamName.trim();

    let team = await prisma.team.findFirst({
      where: {
        code: { equals: normalizedCode, mode: "insensitive" },
        name: { equals: normalizedName, mode: "insensitive" }
      }
    });

    if (!team) {
      const existingByCode = await prisma.team.findFirst({
        where: {
          code: { equals: normalizedCode, mode: "insensitive" }
        }
      });

      if (existingByCode) {
        return res.status(401).json({
          ok: false,
          message: "Team name does not match this team code."
        });
      }

      if (eventHasStarted(event)) {
        return res.status(403).json({
          ok: false,
          message: "Team registration is closed because the event has already started."
        });
      }

      team = await prisma.team.create({
        data: {
          code: normalizedCode,
          name: normalizedName,
          isAdmin: false
        }
      });
    }

    const { token } = await issueTeamSession({ prisma, team, event, config });

    res.cookie(config.COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookie(req, config),
      maxAge: 1000 * 60 * 60 * 8
    });

    const response = TeamSessionResponseSchema.parse({
      ok: true,
      team: {
        id: team.id,
        code: team.code,
        name: team.name,
        isAdmin: team.isAdmin
      }
    });

    return res.json(response);
  });

  app.post("/auth/logout", requireTeamSession({ prisma, config }), async (req, res) => {
    await prisma.teamSession.update({
      where: { id: req.auth.session.id },
      data: { revokedAt: new Date() }
    });

    res.clearCookie(config.COOKIE_NAME, {
      httpOnly: true,
      sameSite: "lax",
      secure: shouldUseSecureCookie(req, config)
    });

    return res.json({ ok: true });
  });

  app.use(requireTeamSession({ prisma, config }));

  app.post("/lifeline/activate", async (req, res) => {
    const parsed = parseBody(LifelineActivateRequestSchema, req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, message: parsed.message });
    }

    if (req.auth.team.isAdmin) {
      return res.status(403).json({ ok: false, message: "Lifeline is only available for participant teams." });
    }

    if (req.auth.team.isBanned) {
      return res.status(423).json({
        ok: false,
        message: "This team is banned by the administrator.",
        enforcement: enforcementForTeam(req.auth.team)
      });
    }

    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const { puzzle, currentPuzzleId, isStarted } = await getAssignedPuzzle(prisma, {
      teamId: req.auth.team.id,
      eventId: event.id,
      identifier: parsed.data.puzzleId,
      isAdmin: false
    });

    if (!puzzle) {
      return res.status(404).json({ ok: false, message: "Puzzle not found in this team's pool." });
    }

    if (!isStarted) {
      return res.status(403).json({ ok: false, message: "Event has not started yet." });
    }

    const canAccess = await teamCanAccessPuzzle(prisma, {
      teamId: req.auth.team.id,
      puzzleId: puzzle.id,
      currentPuzzleId
    });
    if (!canAccess) {
      return res.status(403).json({ ok: false, message: "Lifeline can only be activated for the current puzzle." });
    }

    if ((req.auth.team.lifelinesUsed || 0) >= 2) {
      return res.status(403).json({ ok: false, message: "Lifeline limit reached (maximum 2 per event)." });
    }

    await prisma.team.update({
      where: { id: req.auth.team.id },
      data: { lifelinesUsed: { increment: 1 } }
    });
    req.auth.team.lifelinesUsed = (req.auth.team.lifelinesUsed || 0) + 1;

    const lifeline = activateLifeline({
      teamId: req.auth.team.id,
      puzzleId: puzzle.id
    });

    return res.json({
      ok: true,
      message: "Lifeline activated. Anti-cheat is bypassed until puzzle is switched.",
      enforcement: enforcementPayloadForTeam(req.auth.team, config, lifeline)
    });
  });

  app.post("/lifeline/puzzle-switch", async (req, res) => {
    const parsed = parseBody(LifelinePuzzleSwitchRequestSchema, req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, message: parsed.message });
    }

    if (req.auth.team.isAdmin) {
      return res.json({ ok: true, cleared: false, enforcement: enforcementForTeam(req.auth.team) });
    }

    const nextPuzzleId = parsed.data.puzzleId ? `${parsed.data.puzzleId}`.trim() : null;
    const switched = switchLifelinePuzzle({
      teamId: req.auth.team.id,
      nextPuzzleId: nextPuzzleId || null
    });

    return res.json({
      ok: true,
      cleared: switched.cleared,
      message: switched.cleared
        ? "Lifeline disabled because puzzle was switched."
        : "Lifeline remains active for the current puzzle.",
      enforcement: enforcementForTeam(req.auth.team)
    });
  });

  app.post("/anti-cheat/violation", async (req, res) => {
    const type = `${req.body?.type || "unknown"}`.slice(0, 64);
    const detail = `${req.body?.detail || ""}`.slice(0, 500);
    const maxWarnings = Number(config.MAX_WARNINGS || 3);

    if (req.auth.team.isAdmin) {
      return res.json({
        ok: true,
        message: "Admin session is exempt from anti-cheat enforcement.",
        enforcement: enforcementForTeam(req.auth.team)
      });
    }

    const selectedPuzzleId = `${req.body?.puzzleId || ""}`.trim();
    if (selectedPuzzleId) {
      switchLifelinePuzzle({ teamId: req.auth.team.id, nextPuzzleId: selectedPuzzleId });
    }

    if (req.auth.team.isBanned) {
      return res.status(423).json({
        ok: false,
        message: "This team is banned by the administrator.",
        enforcement: enforcementForTeam(req.auth.team)
      });
    }

    const activeLifeline = getActiveLifeline(req.auth.team.id);
    if (activeLifeline) {
      return res.json({
        ok: true,
        message: "Anti-cheat warning ignored because lifeline is active.",
        warningIssued: false,
        enforcement: enforcementPayloadForTeam(req.auth.team, config, activeLifeline)
      });
    }

    if (req.auth.team.isLocked) {
      return res.status(423).json({
        ok: false,
        message: "This team is already locked due to anti-cheat violations.",
        enforcement: enforcementForTeam(req.auth.team)
      });
    }

    const nextWarningCount = Number(req.auth.team.warningCount || 0) + 1;
    const shouldLock = nextWarningCount >= maxWarnings;
    const lockedAt = shouldLock ? new Date() : req.auth.team.lockedAt;

    const updatedTeam = await prisma.team.update({
      where: { id: req.auth.team.id },
      data: {
        warningCount: nextWarningCount,
        isLocked: shouldLock,
        lockedAt
      }
    });

    await prisma.antiCheatWarning.create({
      data: {
        teamId: updatedTeam.id,
        type,
        detail: detail || null,
        warningNumber: nextWarningCount
      }
    });

    if (shouldLock) {
      await appendAdminAudit(prisma, {
        adminTeamId: req.auth.team.id,
        action: "auto_lock_due_to_warnings",
        entityType: "team",
        entityId: updatedTeam.id,
        details: {
          warningCount: nextWarningCount,
          maxWarnings,
          type,
          detail
        }
      });
    }

    return res.json({
      ok: true,
      warningIssued: true,
      type,
      detail,
      message: shouldLock
        ? `Maximum warnings reached (${maxWarnings}). Team is now locked.`
        : `Warning ${nextWarningCount}/${maxWarnings} issued.`,
      enforcement: enforcementForTeam(updatedTeam)
    });
  });

  app.use((req, res, next) => {
    if (req.auth?.team?.isAdmin) {
      return next();
    }

    if (req.path === "/event/state" || req.path === "/leaderboard") {
      return next();
    }

    if (req.auth?.team?.isBanned) {
      return res.status(423).json({
        ok: false,
        message: "This team is banned by the administrator.",
        enforcement: enforcementForTeam(req.auth.team)
      });
    }

    const activeLifeline = getActiveLifeline(req.auth?.team?.id);
    if (activeLifeline) {
      return next();
    }

    if (!req.auth?.team?.isLocked) {
      return next();
    }

    return res.status(423).json({
      ok: false,
      message: "This team is locked due to anti-cheat violations.",
      enforcement: enforcementForTeam(req.auth.team)
    });
  });

  app.get("/event/state", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const penaltiesPoints = await getTeamPenaltyPoints(prisma, req.auth.team.id);
    const competition = getCompetitionSnapshot(event);

    const payload = EventStateResponseSchema.parse({
      enforcement: enforcementForTeam(req.auth.team),
      ok: true,
      event: buildEventSummary(event),
      competition: {
        isPaused: Boolean(event.isPaused),
        pausedAt: event.pausedAt ? event.pausedAt.toISOString() : null,
        isTimeUp: competition.isTimeUp
      },
      penaltiesPoints,
      remainingSeconds: competition.remainingSeconds,
      now: competition.now.toISOString()
    });

    return res.json(payload);
  });

  app.get("/puzzles", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const teamState = req.auth.team.isAdmin
      ? {
          order: (
            await prisma.puzzle.findMany({
              where: { eventId: event.id },
              orderBy: { orderIndex: "asc" },
              select: { id: true }
            })
          ).map((row) => row.id),
          currentPuzzleId: null,
          currentPuzzleIndex: 0,
          isStarted: true,
          isFinished: false
        }
      : await getTeamPuzzleState(prisma, {
          teamId: req.auth.team.id,
          event
        });
    const puzzleOrder = teamState.order;

    if (!req.auth.team.isAdmin && !teamState.isStarted) {
      return res.json(
        PuzzleListResponseSchema.parse({
          ok: true,
          puzzles: [],
          currentPuzzleId: null,
          currentPuzzleIndex: 0,
          totalPuzzles: 0,
          canAdvance: false,
          canSkip: false,
          isStarted: false,
          isFinished: false
        })
      );
    }

    const puzzles = await prisma.puzzle.findMany({
      where: {
        eventId: event.id,
        id: { in: puzzleOrder }
      }
    });
    const byId = new Map(puzzles.map((row) => [row.id, row]));
    const orderedPuzzles = puzzleOrder.map((id) => byId.get(id)).filter(Boolean);

    const [attempts, solves] = await Promise.all([
      prisma.puzzleAttempt.findMany({
        where: { teamId: req.auth.team.id },
        select: { puzzleId: true }
      }),
      prisma.puzzleSolve.findMany({
        where: { teamId: req.auth.team.id },
        select: { puzzleId: true }
      })
    ]);

    const solvedSet = new Set(solves.map((row) => row.puzzleId));
    const attemptedSet = new Set(attempts.map((row) => row.puzzleId));
    const accessibleSet = req.auth.team.isAdmin
      ? new Set(puzzleOrder)
      : buildAccessiblePuzzleSet(teamState.currentPuzzleId);
    const canAdvance = req.auth.team.isAdmin
      ? false
      : await teamCanAdvance(prisma, {
          teamId: req.auth.team.id,
          currentPuzzleId: teamState.currentPuzzleId,
          event
        });
    const canSkip = req.auth.team.isAdmin
      ? false
      : await teamCanSkip(prisma, {
          teamId: req.auth.team.id,
          currentPuzzleId: teamState.currentPuzzleId,
          event
        });

    const payload = PuzzleListResponseSchema.parse({
      ok: true,
      puzzles: orderedPuzzles
        .map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          type: row.type,
          orderIndex: puzzleOrder.indexOf(row.id) + 1,
          status: statusForPuzzle({ puzzleId: row.id, solvedSet, attemptedSet }),
          toolConfig:
            req.auth.team.isAdmin || accessibleSet.has(row.id)
              ? mapToolConfig(row, {
                  viewerTeamId: req.auth.team.id,
                  isAdmin: req.auth.team.isAdmin
                })
              : PuzzleToolConfigSchema.parse({})
        })),
      currentPuzzleId: teamState.currentPuzzleId,
      currentPuzzleIndex: teamState.currentPuzzleIndex,
      totalPuzzles: puzzleOrder.length,
      canAdvance,
      canSkip,
      isStarted: teamState.isStarted,
      isFinished: teamState.isFinished
    });

    return res.json(payload);
  });

  app.get("/puzzles/:id", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const { puzzle, teamOrderIndex, order, currentPuzzleId, isStarted } = await getAssignedPuzzle(prisma, {
      teamId: req.auth.team.id,
      eventId: event.id,
      identifier: req.params.id,
      includeHints: true,
      isAdmin: req.auth.team.isAdmin
    });

    if (!puzzle) {
      return res.status(404).json({ ok: false, message: "Puzzle not found." });
    }

    if (!req.auth.team.isAdmin && !isStarted) {
      return res.status(403).json({ ok: false, message: "Event has not started yet." });
    }

    if (!req.auth.team.isAdmin) {
      const canAccess = await teamCanAccessPuzzle(prisma, {
        teamId: req.auth.team.id,
        puzzleId: puzzle.id,
        currentPuzzleId
      });
      if (!canAccess) {
        return res.status(403).json({
          ok: false,
          message: "This puzzle is locked. Resume at your current active puzzle.",
          currentPuzzleId
        });
      }
    }

    const [attempts, solve, reveals] = await Promise.all([
      prisma.puzzleAttempt.count({
        where: {
          teamId: req.auth.team.id,
          puzzleId: puzzle.id
        }
      }),
      prisma.puzzleSolve.findUnique({
        where: {
          teamId_puzzleId: {
            teamId: req.auth.team.id,
            puzzleId: puzzle.id
          }
        }
      }),
      prisma.hintRevealAudit.findMany({
        where: {
          teamId: req.auth.team.id,
          puzzleId: puzzle.id
        },
        select: {
          tier: true
        }
      })
    ]);

    const revealedTiers = new Set(reveals.map((entry) => entry.tier));
    const canSeeAllHints = Boolean(req.auth?.team?.isAdmin);
    const canAdvance = req.auth.team.isAdmin
      ? false
      : await teamCanAdvance(prisma, {
          teamId: req.auth.team.id,
          currentPuzzleId,
          event
        });
    const canSkip = req.auth.team.isAdmin
      ? false
      : await teamCanSkip(prisma, {
          teamId: req.auth.team.id,
          currentPuzzleId,
          event
        });

    const payload = PuzzleDetailResponseSchema.parse({
      ok: true,
      puzzle: {
        id: puzzle.id,
        slug: puzzle.slug,
        title: puzzle.title,
        type: puzzle.type,
        prompt: puzzle.prompt,
        orderIndex: teamOrderIndex + 1,
        toolConfig: mapToolConfig(puzzle, {
          viewerTeamId: req.auth.team.id,
          isAdmin: req.auth.team.isAdmin
        }),
        hints: sortHintsByTier(puzzle.hints).map((hint) => ({
          id: hint.id,
          tier: hint.tier,
          content: canSeeAllHints || revealedTiers.has(hint.tier) ? hint.content : "",
          penaltyPoints: hintPenaltyPointsForTier(hint.tier)
        })),
        progress: {
          status: solve ? "solved" : attempts > 0 ? "attempted" : "unsolved",
          attempts,
          solvedAt: solve?.solvedAt ? solve.solvedAt.toISOString() : null,
          canAdvance,
          canSkip,
          isCurrent: req.auth.team.isAdmin ? false : currentPuzzleId === puzzle.id
        }
      }
    });

    return res.json(payload);
  });

  app.get("/puzzles/:id/assets", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const { puzzle, currentPuzzleId, currentPuzzleIndex } = await getAssignedPuzzle(prisma, {
      teamId: req.auth.team.id,
      eventId: event.id,
      identifier: req.params.id,
      isAdmin: req.auth.team.isAdmin
    });

    if (!puzzle) {
      return res.status(404).json({ ok: false, message: "Puzzle not found." });
    }

    if (!req.auth.team.isAdmin) {
      const canAccess = await teamCanAccessPuzzle(prisma, {
        teamId: req.auth.team.id,
        puzzleId: puzzle.id,
        currentPuzzleId
      });
      if (!canAccess) {
        return res.status(403).json({ ok: false, message: "This puzzle is locked.", currentPuzzleId });
      }
    }

    const items = listPuzzleAssets(puzzle.slug, {
      viewerTeamId: req.auth.team.id,
      isAdmin: req.auth.team.isAdmin
    });
    return res.json({ ok: true, items });
  });

  app.get("/puzzle-assets/:slug", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const { puzzle, currentPuzzleId, currentPuzzleIndex } = await getAssignedPuzzle(prisma, {
      teamId: req.auth.team.id,
      eventId: event.id,
      identifier: req.params.slug,
      isAdmin: req.auth.team.isAdmin
    });

    if (!puzzle || puzzle.slug !== req.params.slug) {
      return res.status(404).json({ ok: false, message: "Puzzle not found." });
    }

    if (!req.auth.team.isAdmin) {
      const canAccess = await teamCanAccessPuzzle(prisma, {
        teamId: req.auth.team.id,
        puzzleId: puzzle.id,
        currentPuzzleId
      });
      if (!canAccess) {
        return res.status(403).json({ ok: false, message: "This puzzle is locked.", currentPuzzleId });
      }
    }

    const filePath = resolvePuzzleAssetFile(puzzle.slug, `${req.query.file || ""}`, {
      viewerTeamId: req.auth.team.id,
      isAdmin: req.auth.team.isAdmin,
      allowHidden: req.auth.team.isAdmin
    });
    if (!filePath) {
      return res.status(404).json({ ok: false, message: "Asset file not found." });
    }

    res.set("Cache-Control", "public, max-age=3600, immutable");
    return res.sendFile(filePath);
  });

  app.post("/puzzles/:id/interpreter/run", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const { puzzle, currentPuzzleId, currentPuzzleIndex } = await getAssignedPuzzle(prisma, {
      teamId: req.auth.team.id,
      eventId: event.id,
      identifier: req.params.id,
      isAdmin: req.auth.team.isAdmin
    });

    if (!puzzle) {
      return res.status(404).json({ ok: false, message: "Puzzle not found." });
    }

    if (!req.auth.team.isAdmin) {
      const canAccess = await teamCanAccessPuzzle(prisma, {
        teamId: req.auth.team.id,
        puzzleId: puzzle.id,
        currentPuzzleId
      });
      if (!canAccess) {
        return res.status(403).json({ ok: false, message: "This puzzle is locked.", currentPuzzleId });
      }
    }

    const language = `${req.body?.language || "python"}`.toLowerCase();
    const code = `${req.body?.code || ""}`;
    const stdin = `${req.body?.stdin || ""}`;

    if (!["python", "javascript"].includes(language)) {
      return res.status(400).json({ ok: false, message: "Unsupported language." });
    }

    if (!code.trim()) {
      return res.status(400).json({ ok: false, message: "Code is required." });
    }

    if (code.length > 12000 || stdin.length > 4000) {
      return res.status(400).json({ ok: false, message: "Input too large for interpreter." });
    }

    const result = await runCodeSnippet({ language, code, stdin });

    return res.json({
      ok: true,
      language,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      exitCode: result.exitCode,
      timedOut: Boolean(result.timedOut),
      runtimeError: result.ok ? null : result.error || "Runtime execution failed."
    });
  });

  app.post("/puzzles/:id/interpreter/check", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const { puzzle, currentPuzzleId, currentPuzzleIndex } = await getAssignedPuzzle(prisma, {
      teamId: req.auth.team.id,
      eventId: event.id,
      identifier: req.params.id,
      isAdmin: req.auth.team.isAdmin
    });

    if (!puzzle) {
      return res.status(404).json({ ok: false, message: "Puzzle not found." });
    }

    if (!req.auth.team.isAdmin) {
      const canAccess = await teamCanAccessPuzzle(prisma, {
        teamId: req.auth.team.id,
        puzzleId: puzzle.id,
        currentPuzzleId
      });
      if (!canAccess) {
        return res.status(403).json({ ok: false, message: "This puzzle is locked.", currentPuzzleId });
      }
    }

    const language = `${req.body?.language || "python"}`.toLowerCase();
    const code = `${req.body?.code || ""}`;
    const stdin = `${req.body?.stdin || ""}`;

    if (![
      "python",
      "javascript"
    ].includes(language)) {
      return res.status(400).json({ ok: false, message: "Unsupported language." });
    }

    if (!code.trim()) {
      return res.status(400).json({ ok: false, message: "Code is required." });
    }

    if (code.length > 12000 || stdin.length > 4000) {
      return res.status(400).json({ ok: false, message: "Input too large for interpreter." });
    }

    const candidateResult = await runCodeSnippet({ language, code, stdin });
    const candidateRuntimeError = candidateResult.ok ? null : candidateResult.error || "Runtime execution failed.";

    if (candidateRuntimeError || candidateResult.timedOut) {
      return res.json({
        ok: true,
        language,
        isCorrect: false,
        message: "Code execution failed. Fix runtime issues before verification.",
        candidate: {
          stdout: candidateResult.stdout || "",
          stderr: candidateResult.stderr || "",
          exitCode: candidateResult.exitCode,
          timedOut: Boolean(candidateResult.timedOut),
          runtimeError: candidateRuntimeError
        },
        checker: {
          fileName: null,
          exitCode: null,
          timedOut: false,
          runtimeError: null
        }
      });
    }

    const checkerFilePath = findValidationCodeFile(puzzle.slug, language);
    if (!checkerFilePath) {
      return res.status(400).json({
        ok: false,
        message:
          "No checker file found for this puzzle. Upload a solution/verifier file (e.g. solution.py) from Admin."
      });
    }

    const checkerResult = await runCodeFile({
      language,
      filePath: checkerFilePath,
      stdin
    });

    const checkerRuntimeError = checkerResult.ok ? null : checkerResult.error || "Checker runtime execution failed.";
    if (checkerRuntimeError || checkerResult.timedOut) {
      return res.status(500).json({
        ok: false,
        message: "Checker file failed to execute. Please update the correct file in Admin uploads.",
        checker: {
          fileName: path.basename(checkerFilePath),
          exitCode: checkerResult.exitCode,
          timedOut: Boolean(checkerResult.timedOut),
          runtimeError: checkerRuntimeError,
          stderr: checkerResult.stderr || ""
        }
      });
    }

    const candidateNormalized = normalizeAnswer(candidateResult.stdout || "");
    const expectedNormalized = normalizeAnswer(checkerResult.stdout || "");
    const isCorrect = candidateNormalized === expectedNormalized;

    if (isCorrect && !req.auth.team.isAdmin) {
      const lockKey = `${req.auth.team.id}:${puzzle.id}`;
      if (!SUBMISSION_LOCKS.has(lockKey)) {
        SUBMISSION_LOCKS.add(lockKey);
        try {
          const existingSolve = await prisma.puzzleSolve.findUnique({
            where: {
              teamId_puzzleId: {
                teamId: req.auth.team.id,
                puzzleId: puzzle.id
              }
            }
          });

          if (!existingSolve) {
            const attempt = await prisma.puzzleAttempt.create({
              data: {
                teamId: req.auth.team.id,
                puzzleId: puzzle.id,
                answer: "CODE_INTERPRETER_VERIFY",
                isCorrect: true
              }
            });

            await prisma.puzzleSolve.create({
              data: {
                teamId: req.auth.team.id,
                puzzleId: puzzle.id,
                firstAttemptId: attempt.id
              }
            });
            clearLeaderboardCache();
            await broadcastPublicSnapshot();
          }
        } finally {
          SUBMISSION_LOCKS.delete(lockKey);
        }
      }
    }

    return res.json({
      ok: true,
      language,
      isCorrect,
      message: isCorrect
        ? "Verification passed. Your output matches the correct file output."
        : "Verification failed. Output does not match the correct file output.",
      candidate: {
        stdout: candidateResult.stdout || "",
        stderr: candidateResult.stderr || "",
        exitCode: candidateResult.exitCode,
        timedOut: Boolean(candidateResult.timedOut),
        runtimeError: candidateRuntimeError
      },
      checker: {
        fileName: path.basename(checkerFilePath),
        exitCode: checkerResult.exitCode,
        timedOut: Boolean(checkerResult.timedOut),
        runtimeError: checkerRuntimeError
      }
    });
  });

  app.get("/puzzles/:id/notepad", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const { puzzle, currentPuzzleId, currentPuzzleIndex } = await getAssignedPuzzle(prisma, {
      teamId: req.auth.team.id,
      eventId: event.id,
      identifier: req.params.id,
      isAdmin: req.auth.team.isAdmin
    });
    if (!puzzle) {
      return res.status(404).json({ ok: false, message: "Puzzle not found." });
    }

    if (!req.auth.team.isAdmin) {
      const canAccess = await teamCanAccessPuzzle(prisma, {
        teamId: req.auth.team.id,
        puzzleId: puzzle.id,
        currentPuzzleId
      });
      if (!canAccess) {
        return res.status(403).json({ ok: false, message: "This puzzle is locked.", currentPuzzleId });
      }
    }

    const puzzleId = puzzle.id;
    const notepad = await prisma.notepad.findUnique({
      where: {
        teamId_puzzleId: {
          teamId: req.auth.team.id,
          puzzleId
        }
      }
    });

    const payload = NotepadResponseSchema.parse({
      ok: true,
      puzzleId,
      content: notepad?.content || "",
      updatedAt: notepad?.updatedAt ? notepad.updatedAt.toISOString() : null
    });

    return res.json(payload);
  });

  app.post("/puzzles/:id/notepad", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const { puzzle, currentPuzzleId, currentPuzzleIndex } = await getAssignedPuzzle(prisma, {
      teamId: req.auth.team.id,
      eventId: event.id,
      identifier: req.params.id,
      isAdmin: req.auth.team.isAdmin
    });
    if (!puzzle) {
      return res.status(404).json({ ok: false, message: "Puzzle not found." });
    }

    if (!req.auth.team.isAdmin) {
      const canAccess = await teamCanAccessPuzzle(prisma, {
        teamId: req.auth.team.id,
        puzzleId: puzzle.id,
        currentPuzzleId
      });
      if (!canAccess) {
        return res.status(403).json({ ok: false, message: "This puzzle is locked.", currentPuzzleId });
      }
    }

    const puzzleId = puzzle.id;
    const parsed = parseBody(NotepadUpsertRequestSchema, req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, message: parsed.message });
    }

    const notepad = await prisma.notepad.upsert({
      where: {
        teamId_puzzleId: {
          teamId: req.auth.team.id,
          puzzleId
        }
      },
      create: {
        teamId: req.auth.team.id,
        puzzleId,
        content: parsed.data.content
      },
      update: {
        content: parsed.data.content
      }
    });

    const payload = NotepadResponseSchema.parse({
      ok: true,
      puzzleId,
      content: notepad.content,
      updatedAt: notepad.updatedAt.toISOString()
    });

    return res.json(payload);
  });

  app.get("/clipboard", async (req, res) => {
    const entries = await prisma.clipboardEntry.findMany({
      where: { teamId: req.auth.team.id },
      orderBy: { createdAt: "desc" },
      take: 5
    });

    const payload = ClipboardResponseSchema.parse({
      ok: true,
      entries: entries.map((entry) => ({
        id: entry.id,
        value: entry.value,
        source: entry.source,
        createdAt: entry.createdAt.toISOString()
      }))
    });

    return res.json(payload);
  });

  app.post("/clipboard", async (req, res) => {
    const parsed = parseBody(ClipboardCreateRequestSchema, req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, message: parsed.message });
    }

    const entries = await prisma.$transaction(async (tx) => {
      await tx.clipboardEntry.create({
        data: {
          teamId: req.auth.team.id,
          value: parsed.data.value,
          source: parsed.data.source
        }
      });

      const allEntries = await tx.clipboardEntry.findMany({
        where: { teamId: req.auth.team.id },
        orderBy: { createdAt: "desc" }
      });

      if (allEntries.length > 5) {
        const staleIds = allEntries.slice(5).map((entry) => entry.id);
        await tx.clipboardEntry.deleteMany({
          where: {
            id: { in: staleIds }
          }
        });
      }

      return tx.clipboardEntry.findMany({
        where: { teamId: req.auth.team.id },
        orderBy: { createdAt: "desc" },
        take: 5
      });
    });

    const payload = ClipboardResponseSchema.parse({
      ok: true,
      entries: entries.map((entry) => ({
        id: entry.id,
        value: entry.value,
        source: entry.source,
        createdAt: entry.createdAt.toISOString()
      }))
    });

    return res.json(payload);
  });

  app.post("/puzzles/:id/hints/:tier/reveal", async (req, res) => {
    const tierParsed = HintTierSchema.safeParse(req.params.tier);
    if (!tierParsed.success) {
      return res.status(400).json({ ok: false, message: "Invalid hint tier." });
    }

    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const { puzzle, currentPuzzleId, currentPuzzleIndex } = await getAssignedPuzzle(prisma, {
      teamId: req.auth.team.id,
      eventId: event.id,
      identifier: req.params.id,
      includeHints: true,
      isAdmin: req.auth.team.isAdmin
    });

    if (!puzzle) {
      return res.status(404).json({ ok: false, message: "Puzzle not found." });
    }

    if (!req.auth.team.isAdmin) {
      const canAccess = await teamCanAccessPuzzle(prisma, {
        teamId: req.auth.team.id,
        puzzleId: puzzle.id,
        currentPuzzleId
      });
      if (!canAccess) {
        return res.status(403).json({ ok: false, message: "This puzzle is locked.", currentPuzzleId });
      }
    }

    const tier = tierParsed.data;
    const hint = puzzle.hints.find((entry) => entry.tier === tier);
    if (!hint) {
      return res.status(404).json({ ok: false, message: "Hint not found for this tier." });
    }

    const existingReveal = await prisma.hintRevealAudit.findUnique({
      where: {
        teamId_puzzleId_tier: {
          teamId: req.auth.team.id,
          puzzleId: puzzle.id,
          tier
        }
      }
    });

    let penaltyAppliedPoints = 0;
    if (!existingReveal) {
      penaltyAppliedPoints = hintPenaltyPointsForTier(tier);
      await prisma.hintRevealAudit.create({
        data: {
          teamId: req.auth.team.id,
          puzzleId: puzzle.id,
          puzzleHintId: hint.id,
          tier,
          penaltySeconds: penaltyAppliedPoints
        }
      });

      if (penaltyAppliedPoints > 0) {
        clearLeaderboardCache();
      }
    }

    const totalPenaltyPoints = await getTeamPenaltyPoints(prisma, req.auth.team.id);

    const payload = HintRevealResponseSchema.parse({
      ok: true,
      hint: {
        id: hint.id,
        tier: hint.tier,
        content: hint.content,
        penaltyPoints: hintPenaltyPointsForTier(hint.tier)
      },
      penaltyAppliedPoints,
      totalPenaltyPoints
    });

    return res.json(payload);
  });

  app.post("/puzzles/:id/submit", async (req, res) => {
    const parsed = parseBody(PuzzleSubmitRequestSchema, req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, message: parsed.message });
    }

    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const { puzzle, currentPuzzleId, currentPuzzleIndex } = await getAssignedPuzzle(prisma, {
      teamId: req.auth.team.id,
      eventId: event.id,
      identifier: req.params.id,
      isAdmin: req.auth.team.isAdmin
    });

    if (!puzzle) {
      return res.status(404).json({ ok: false, message: "Puzzle not found." });
    }

    if (!req.auth.team.isAdmin) {
      const canAccess = await teamCanAccessPuzzle(prisma, {
        teamId: req.auth.team.id,
        puzzleId: puzzle.id,
        currentPuzzleId
      });
      if (!canAccess) {
        return res.status(403).json({ ok: false, message: "This puzzle is locked.", currentPuzzleId });
      }
    }

    if (!req.auth.team.isAdmin && getCompetitionSnapshot(event).isTimeUp) {
      return res.status(423).json({ ok: false, message: "Time is up for this event." });
    }

    const lockKey = `${req.auth.team.id}:${puzzle.id}`;
    if (SUBMISSION_LOCKS.has(lockKey)) {
      return res.status(409).json({ ok: false, message: "Submission already in progress." });
    }

    SUBMISSION_LOCKS.add(lockKey);

    try {
      const existingSolve = await prisma.puzzleSolve.findUnique({
        where: {
          teamId_puzzleId: {
            teamId: req.auth.team.id,
            puzzleId: puzzle.id
          }
        }
      });

      if (existingSolve) {
        return res.status(409).json({
          ok: false,
          message: "Current puzzle is already solved. Click Next Puzzle to continue."
        });
      }

      const normalizedAttempt = normalizeAnswer(parsed.data.answer);
      const normalizedExpected = normalizeAnswer(puzzle.answerKey);
      const isCorrect = normalizedAttempt === normalizedExpected;

      const attempt = await prisma.puzzleAttempt.create({
        data: {
          teamId: req.auth.team.id,
          puzzleId: puzzle.id,
          answer: normalizedAttempt,
          isCorrect
        }
      });

      const shouldCreateSolve = isCorrect && !existingSolve;
      let solve = existingSolve;

      if (shouldCreateSolve) {
        solve = await prisma.puzzleSolve.upsert({
          where: {
            teamId_puzzleId: {
              teamId: req.auth.team.id,
              puzzleId: puzzle.id
            }
          },
          create: {
            teamId: req.auth.team.id,
            puzzleId: puzzle.id,
            firstAttemptId: attempt.id
          },
          update: {}
        });
      }
      clearLeaderboardCache();
      await broadcastPublicSnapshot();

      const payload = PuzzleSubmitResponseSchema.parse({
        ok: true,
        result: isCorrect ? "correct" : "incorrect",
        message: isCorrect
          ? "Correct answer submitted. Click Next Puzzle to continue."
          : "Incorrect answer submitted. Try again.",
        status: solve ? "solved" : "attempted",
        answer: normalizedAttempt,
        canAdvance: Boolean(solve),
        currentPuzzleId,
        currentPuzzleIndex
      });

      return res.json(payload);
    } finally {
      SUBMISSION_LOCKS.delete(lockKey);
    }
  });

  app.post("/puzzles/current/advance", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    if (req.auth.team.isAdmin) {
      return res.status(403).json({ ok: false, message: "Advance is only available to participant teams." });
    }

    if (!eventHasStarted(event)) {
      return res.status(403).json({ ok: false, message: "Event has not started yet." });
    }

    if (getCompetitionSnapshot(event).isTimeUp) {
      return res.status(423).json({ ok: false, message: "Time is up for this event." });
    }

    const state = await getTeamPuzzleState(prisma, {
      teamId: req.auth.team.id,
      event
    });

    if (!state.teamSet || !state.currentPuzzleId) {
      return res.status(400).json({ ok: false, message: "No active puzzle is available to advance from." });
    }

    const canAdvance = await teamCanAdvance(prisma, {
      teamId: req.auth.team.id,
      currentPuzzleId: state.currentPuzzleId,
      event
    });
    if (!canAdvance) {
      return res.status(400).json({ ok: false, message: "Solve the current puzzle before advancing." });
    }

    const nextIndex = state.currentPuzzleIndex + 1;
    const updated = await prisma.teamPuzzleSet.update({
      where: { id: state.teamSet.id },
      data: {
        currentPuzzleIndex: nextIndex
      }
    });

    clearLifeline(req.auth.team.id);
    await broadcastPublicSnapshot();

    return res.json({
      ok: true,
      message:
        nextIndex >= state.order.length
          ? "All assigned puzzles completed."
          : "Advanced to the next puzzle.",
      currentPuzzleIndex: normalizeCurrentPuzzleIndex(updated.currentPuzzleIndex, state.order.length),
      currentPuzzleId:
        nextIndex >= state.order.length ? null : state.order[nextIndex],
      isFinished: nextIndex >= state.order.length
    });
  });

  app.post("/puzzles/current/skip", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    if (req.auth.team.isAdmin) {
      return res.status(403).json({ ok: false, message: "Skip is only available to participant teams." });
    }

    if (!eventHasStarted(event)) {
      return res.status(403).json({ ok: false, message: "Event has not started yet." });
    }

    if (getCompetitionSnapshot(event).isTimeUp) {
      return res.status(423).json({ ok: false, message: "Time is up for this event." });
    }

    const state = await getTeamPuzzleState(prisma, {
      teamId: req.auth.team.id,
      event
    });

    if (!state.teamSet || !state.currentPuzzleId) {
      return res.status(400).json({ ok: false, message: "No active puzzle is available to skip." });
    }

    const canSkip = await teamCanSkip(prisma, {
      teamId: req.auth.team.id,
      currentPuzzleId: state.currentPuzzleId,
      event
    });
    if (!canSkip) {
      return res.status(400).json({ ok: false, message: "Solved puzzles cannot be skipped. Use Next Puzzle instead." });
    }

    const skippedPuzzleId = state.currentPuzzleId;
    const nextIndex = state.currentPuzzleIndex + 1;
    const updated = await prisma.teamPuzzleSet.update({
      where: { id: state.teamSet.id },
      data: {
        currentPuzzleIndex: nextIndex
      }
    });

    clearLifeline(req.auth.team.id);
    await broadcastPublicSnapshot();

    return res.json({
      ok: true,
      message:
        nextIndex >= state.order.length
          ? "Current puzzle skipped. No more assigned puzzles remain."
          : "Current puzzle skipped. You cannot return to it.",
      skippedPuzzleId,
      currentPuzzleIndex: normalizeCurrentPuzzleIndex(updated.currentPuzzleIndex, state.order.length),
      currentPuzzleId: nextIndex >= state.order.length ? null : state.order[nextIndex],
      isFinished: nextIndex >= state.order.length
    });
  });

  app.get("/progress", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const teamState = req.auth.team.isAdmin
      ? {
          order: (
            await prisma.puzzle.findMany({
              where: { eventId: event.id },
              orderBy: { orderIndex: "asc" },
              select: { id: true }
            })
          ).map((row) => row.id),
          currentPuzzleId: null,
          currentPuzzleIndex: 0,
          isStarted: true,
          isFinished: false
        }
      : await getTeamPuzzleState(prisma, {
          teamId: req.auth.team.id,
          event
        });
    const puzzleOrder = teamState.order;

    if (!req.auth.team.isAdmin && !teamState.isStarted) {
      return res.json(
        ProgressResponseSchema.parse({
          ok: true,
          items: [],
          currentPuzzleId: null,
          currentPuzzleIndex: 0,
          totalPuzzles: 0,
          canAdvance: false,
          canSkip: false,
          isStarted: false,
          isFinished: false
        })
      );
    }

    const puzzles = await prisma.puzzle.findMany({
      where: {
        eventId: event.id,
        id: { in: puzzleOrder }
      }
    });
    const byId = new Map(puzzles.map((row) => [row.id, row]));
    const orderedPuzzles = puzzleOrder.map((id) => byId.get(id)).filter(Boolean);

    const [attempts, solves] = await Promise.all([
      prisma.puzzleAttempt.findMany({
        where: { teamId: req.auth.team.id },
        select: { puzzleId: true }
      }),
      prisma.puzzleSolve.findMany({
        where: { teamId: req.auth.team.id },
        select: { puzzleId: true }
      })
    ]);

    const solvedSet = new Set(solves.map((row) => row.puzzleId));
    const attemptedSet = new Set(attempts.map((row) => row.puzzleId));
    const accessibleSet = req.auth.team.isAdmin
      ? new Set(puzzleOrder)
      : buildAccessiblePuzzleSet(teamState.currentPuzzleId);
    const canAdvance = req.auth.team.isAdmin
      ? false
      : await teamCanAdvance(prisma, {
          teamId: req.auth.team.id,
          currentPuzzleId: teamState.currentPuzzleId,
          event
        });
    const canSkip = req.auth.team.isAdmin
      ? false
      : await teamCanSkip(prisma, {
          teamId: req.auth.team.id,
          currentPuzzleId: teamState.currentPuzzleId,
          event
        });

    const items = orderedPuzzles
      .map((puzzle) => ({
        puzzleId: puzzle.id,
        title: accessibleSet.has(puzzle.id) ? puzzle.title : "Locked Puzzle",
        status: statusForPuzzle({
          puzzleId: puzzle.id,
          solvedSet,
          attemptedSet
        })
      }));

    const payload = ProgressResponseSchema.parse({
      ok: true,
      items,
      currentPuzzleId: teamState.currentPuzzleId,
      currentPuzzleIndex: teamState.currentPuzzleIndex,
      totalPuzzles: puzzleOrder.length,
      canAdvance,
      canSkip,
      isStarted: teamState.isStarted,
      isFinished: teamState.isFinished
    });

    return res.json(payload);
  });

  const adminRouter = express.Router();
  adminRouter.use(requireAdmin);

  adminRouter.get("/teams/monitor", async (_req, res) => {
    const event = await getActiveEvent(prisma);
    const teams = await prisma.team.findMany({
      orderBy: { name: "asc" }
    });
    const now = new Date();
    const startedAtMs = event?.startsAt ? new Date(event.startsAt).getTime() : null;

    const allPuzzles = await prisma.puzzle.findMany({ select: { id: true, title: true } });
    const pointsById = new Map();
    for (const p of allPuzzles) {
      pointsById.set(p.id, getPuzzlePoints(p.title));
    }

    const rows = await Promise.all(
      teams.map(async (team) => {
        const [activeSessionCount, totalSessionCount, attemptCount, solvedRows, hintPenaltyPoints, lastSession] =
          await Promise.all([
            prisma.teamSession.count({
              where: {
                teamId: team.id,
                revokedAt: null,
                expiresAt: { gt: now }
              }
            }),
            prisma.teamSession.count({
              where: { teamId: team.id }
            }),
            prisma.puzzleAttempt.count({
              where: { teamId: team.id }
            }),
            prisma.puzzleSolve.findMany({
              where: { teamId: team.id },
              select: { puzzleId: true, solvedAt: true }
            }),
            getTeamPenaltyPoints(prisma, team.id),
            prisma.teamSession.findFirst({
              where: { teamId: team.id },
              orderBy: { createdAt: "desc" },
              select: {
                createdAt: true,
                expiresAt: true,
                revokedAt: true
              }
            })
          ]);

        let points = 0;
        for (const solve of solvedRows) {
          points += pointsById.get(solve.puzzleId) || 1;
        }
        const lastCorrectAt = getLastSolvedAt(solvedRows);
        const totalElapsedSeconds =
          lastCorrectAt && startedAtMs !== null
            ? Math.max(0, Math.floor((lastCorrectAt.getTime() - startedAtMs) / 1000))
            : null;

        return {
          id: team.id,
          code: team.code,
          name: team.name,
          isAdmin: team.isAdmin,
          warningCount: Number(team.warningCount || 0),
          isLocked: Boolean(team.isLocked),
          lockedAt: team.lockedAt ? team.lockedAt.toISOString() : null,
          isBanned: Boolean(team.isBanned),
          bannedAt: team.bannedAt ? team.bannedAt.toISOString() : null,
          activeSessionCount,
          totalSessionCount,
          attemptCount,
          points,
          hintPenaltyPoints,
          totalElapsedSeconds,
          lastCorrectAt: lastCorrectAt ? lastCorrectAt.toISOString() : null,
          lastSession: lastSession
            ? {
                createdAt: lastSession.createdAt.toISOString(),
                expiresAt: lastSession.expiresAt.toISOString(),
                revokedAt: lastSession.revokedAt ? lastSession.revokedAt.toISOString() : null
              }
            : null
        };
      })
    );

    return res.json({ ok: true, teams: rows });
  });

  adminRouter.patch("/event-settings", async (req, res) => {
    const parsed = parseBody(AdminEventSettingsUpdateSchema, req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, message: parsed.message });
    }

    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    if (eventHasStarted(event)) {
      return res.status(409).json({ ok: false, message: "Event settings cannot be changed after the event starts." });
    }

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        puzzleCount: parsed.data.puzzleCount
      }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "update_event_settings",
      entityType: "event",
      entityId: updated.id,
      details: {
        puzzleCount: updated.puzzleCount
      }
    });

    await broadcastPublicSnapshot();

    return res.json({
      ok: true,
      event: buildEventSummary(updated)
    });
  });

  adminRouter.post("/event-start", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    try {
      const started = await startEventAssignments(event, req.auth.team.id);
      return res.json({
        ok: true,
        event: buildEventSummary(started),
        competition: buildPublicEventStatePayload(started).competition
      });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error.message || "Unable to start the event." });
    }
  });

  adminRouter.post("/event-end", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    if (!eventHasStarted(event)) {
      return res.status(400).json({ ok: false, message: "Event has not started yet." });
    }

    const endedAt = new Date();
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        endsAt: endedAt,
        isPaused: false,
        pausedAt: null
      }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "end_event",
      entityType: "event",
      entityId: updated.id,
      details: {
        endedAt: endedAt.toISOString()
      }
    });

    await broadcastPublicSnapshot();

    return res.json({
      ok: true,
      event: buildEventSummary(updated),
      competition: buildPublicEventStatePayload(updated).competition
    });
  });

  adminRouter.post("/timer/pause-all", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    if (event.isPaused) {
      return res.json({
        ok: true,
        eventId: event.id,
        isPaused: true,
        pausedAt: event.pausedAt ? event.pausedAt.toISOString() : null,
        endsAt: event.endsAt.toISOString()
      });
    }

    const pausedAt = new Date();
    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        isPaused: true,
        pausedAt
      }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "pause_timer_all",
      entityType: "event",
      entityId: updated.id,
      details: {
        pausedAt: pausedAt.toISOString()
      }
    });

    await broadcastPublicSnapshot();

    return res.json({
      ok: true,
      eventId: updated.id,
      isPaused: true,
      pausedAt: pausedAt.toISOString(),
      endsAt: updated.endsAt.toISOString()
    });
  });

  adminRouter.post("/timer/resume-all", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    if (!event.isPaused) {
      return res.json({
        ok: true,
        eventId: event.id,
        isPaused: false,
        pausedAt: null,
        endsAt: event.endsAt.toISOString(),
        pauseDurationSeconds: 0
      });
    }

    const resumedAt = new Date();
    const pausedAt = event.pausedAt ? new Date(event.pausedAt) : resumedAt;
    const pauseDurationMs = Math.max(0, resumedAt.getTime() - pausedAt.getTime());
    const adjustedEndsAt = new Date(event.endsAt.getTime() + pauseDurationMs);

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        isPaused: false,
        pausedAt: null,
        endsAt: adjustedEndsAt
      }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "resume_timer_all",
      entityType: "event",
      entityId: updated.id,
      details: {
        resumedAt: resumedAt.toISOString(),
        pauseDurationSeconds: Math.floor(pauseDurationMs / 1000),
        adjustedEndsAt: adjustedEndsAt.toISOString()
      }
    });

    await broadcastPublicSnapshot();

    return res.json({
      ok: true,
      eventId: updated.id,
      isPaused: false,
      pausedAt: null,
      endsAt: adjustedEndsAt.toISOString(),
      pauseDurationSeconds: Math.floor(pauseDurationMs / 1000)
    });
  });

  adminRouter.post("/timer/reset-all", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    if (eventHasStarted(event)) {
      return res.status(409).json({ ok: false, message: "Timer reset is disabled after the event starts." });
    }

    const resetAt = new Date();
    const durationSeconds = Math.max(60, Number(config.EVENT_DURATION_SECONDS || 3600));
    const nextEndsAt = new Date(resetAt.getTime() + durationSeconds * 1000);

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: {
        startsAt: resetAt,
        endsAt: nextEndsAt,
        isPaused: false,
        pausedAt: null
      }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "reset_timer_all",
      entityType: "event",
      entityId: updated.id,
      details: {
        durationSeconds,
        resetAt: resetAt.toISOString(),
        endsAt: nextEndsAt.toISOString()
      }
    });

    await broadcastPublicSnapshot();

    return res.json({
      ok: true,
      eventId: updated.id,
      isPaused: false,
      pausedAt: null,
      startsAt: updated.startsAt.toISOString(),
      endsAt: updated.endsAt.toISOString(),
      durationSeconds
    });
  });

  adminRouter.post("/event-reset", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.puzzleSolve.deleteMany({});
        await tx.puzzleAttempt.deleteMany({});
        await tx.hintRevealAudit.deleteMany({});
        await tx.notepad.deleteMany({});
        await tx.clipboardEntry.deleteMany({});
        await tx.antiCheatWarning.deleteMany({});
        await tx.teamPuzzleSet.deleteMany({ where: { eventId: event.id } });

        const resetAt = new Date();
        const durationSeconds = Math.max(60, Number(config.EVENT_DURATION_SECONDS || 3600));
        const nextEndsAt = new Date(resetAt.getTime() + durationSeconds * 1000);

        await tx.event.update({
          where: { id: event.id },
          data: {
            startedAt: null,
            startsAt: resetAt,
            endsAt: nextEndsAt,
            isPaused: false,
            pausedAt: null,
            frozenPuzzleIds: null
          }
        });

        await tx.team.updateMany({
          data: { lifelinesUsed: 0 }
        });
      });

      activeLifelines.clear();

      await appendAdminAudit(prisma, {
        adminTeamId: req.auth.team.id,
        action: "factory_reset_event",
        entityType: "event",
        entityId: event.id,
        details: { resetAt: new Date().toISOString() }
      });

      clearLeaderboardCache();
      await broadcastPublicSnapshot();

      return res.json({ ok: true, message: "Event successfully factory reset." });
    } catch (error) {
      return res.status(500).json({ ok: false, message: "Unable to factory reset event: " + error.message });
    }
  });

  adminRouter.post("/teams/ban-all", async (req, res) => {
    const bannedAt = new Date();
    const result = await prisma.team.updateMany({
      where: { isAdmin: false },
      data: {
        isBanned: true,
        bannedAt
      }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "ban_all_teams",
      entityType: "team",
      details: {
        updatedCount: result.count,
        bannedAt: bannedAt.toISOString()
      }
    });

    return res.json({ ok: true, updatedCount: result.count, bannedAt: bannedAt.toISOString() });
  });

  adminRouter.post("/teams/unban-all", async (req, res) => {
    const result = await prisma.team.updateMany({
      where: { isAdmin: false },
      data: {
        isBanned: false,
        bannedAt: null
      }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "unban_all_teams",
      entityType: "team",
      details: {
        updatedCount: result.count
      }
    });

    return res.json({ ok: true, updatedCount: result.count });
  });

  adminRouter.post("/teams/:teamId/ban", async (req, res) => {
    const team = await prisma.team.findUnique({ where: { id: req.params.teamId } });
    if (!team) {
      return res.status(404).json({ ok: false, message: "Team not found." });
    }

    if (team.isAdmin) {
      return res.status(400).json({ ok: false, message: "Admin teams cannot be banned." });
    }

    const bannedAt = new Date();
    const updated = await prisma.team.update({
      where: { id: team.id },
      data: {
        isBanned: true,
        bannedAt
      }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "ban_team",
      entityType: "team",
      entityId: updated.id,
      details: {
        code: updated.code,
        name: updated.name,
        bannedAt: bannedAt.toISOString()
      }
    });

    return res.json({
      ok: true,
      team: {
        id: updated.id,
        code: updated.code,
        name: updated.name,
        isBanned: true,
        bannedAt: bannedAt.toISOString()
      }
    });
  });

  adminRouter.post("/teams/:teamId/unban", async (req, res) => {
    const team = await prisma.team.findUnique({ where: { id: req.params.teamId } });
    if (!team) {
      return res.status(404).json({ ok: false, message: "Team not found." });
    }

    const updated = await prisma.team.update({
      where: { id: team.id },
      data: {
        isBanned: false,
        bannedAt: null
      }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "unban_team",
      entityType: "team",
      entityId: updated.id,
      details: {
        code: updated.code,
        name: updated.name
      }
    });

    return res.json({
      ok: true,
      team: {
        id: updated.id,
        code: updated.code,
        name: updated.name,
        isBanned: false,
        bannedAt: null
      }
    });
  });

  adminRouter.post("/teams/:teamId/unlock", async (req, res) => {
    const team = await prisma.team.findUnique({ where: { id: req.params.teamId } });
    if (!team) {
      return res.status(404).json({ ok: false, message: "Team not found." });
    }

    if (team.isAdmin) {
      return res.status(400).json({ ok: false, message: "Admin teams cannot be unlocked." });
    }

    const updated = await prisma.team.update({
      where: { id: team.id },
      data: {
        isLocked: false,
        lockedAt: null,
        warningCount: 0
      }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "unlock_team",
      entityType: "team",
      entityId: updated.id,
      details: {
        code: updated.code,
        name: updated.name,
        warningCount: updated.warningCount,
        unlockedAt: new Date().toISOString()
      }
    });

    return res.json({
      ok: true,
      team: {
        id: updated.id,
        code: updated.code,
        name: updated.name,
        isLocked: false,
        lockedAt: null,
        warningCount: updated.warningCount
      }
    });
  });

  adminRouter.post("/teams/:teamId/puzzle-pool", async (req, res) => {
    return res.status(409).json({
      ok: false,
      message: "Manual team puzzle pool generation is disabled with frozen event orders."
    });
  });

  adminRouter.get("/teams/:teamId/puzzle-pool", async (req, res) => {
    const team = await prisma.team.findUnique({ where: { id: req.params.teamId } });
    if (!team) {
      return res.status(404).json({ ok: false, message: "Team not found." });
    }

    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    const puzzleOrder = team.isAdmin
      ? (
          await prisma.puzzle.findMany({
            where: { eventId: event.id },
            orderBy: { orderIndex: "asc" },
            select: { id: true }
          })
        ).map((row) => row.id)
      : await getTeamPuzzleOrder(prisma, {
          teamId: team.id,
          eventId: event.id
        });

    const puzzles = await prisma.puzzle.findMany({
      where: {
        eventId: event.id,
        id: { in: puzzleOrder }
      }
    });
    const byId = new Map(puzzles.map((row) => [row.id, row]));

    const [attempts, solves] = await Promise.all([
      prisma.puzzleAttempt.findMany({
        where: { teamId: team.id },
        select: { puzzleId: true }
      }),
      prisma.puzzleSolve.findMany({
        where: { teamId: team.id },
        select: { puzzleId: true }
      })
    ]);

    const solvedSet = new Set(solves.map((row) => row.puzzleId));
    const attemptedSet = new Set(attempts.map((row) => row.puzzleId));

    const items = puzzleOrder
      .map((puzzleId, index) => {
        const puzzle = byId.get(puzzleId);
        if (!puzzle) {
          return null;
        }

        return {
          orderIndex: index + 1,
          puzzleId: puzzle.id,
          slug: puzzle.slug,
          title: puzzle.title,
          type: puzzle.type,
          status: statusForPuzzle({ puzzleId: puzzle.id, solvedSet, attemptedSet })
        };
      })
      .filter(Boolean);

    return res.json({
      ok: true,
      team: {
        id: team.id,
        code: team.code,
        name: team.name,
        isAdmin: team.isAdmin
      },
      items,
      targetedItems: []
    });
  });

  adminRouter.post("/puzzles/:id/remove-from-team", async (req, res) => {
    return res.status(409).json({
      ok: false,
      message: "Per-team puzzle removal is disabled with frozen event orders."
    });
  });

  adminRouter.get("/sessions/monitor", async (_req, res) => {
    const sessions = await prisma.teamSession.findMany({
      where: {
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      include: {
        team: {
          select: {
            id: true,
            code: true,
            name: true,
            isAdmin: true
          }
        }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });

    return res.json({
      ok: true,
      sessions: sessions.map((session) => ({
        id: session.id,
        teamId: session.teamId,
        team: session.team,
        createdAt: session.createdAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        revokedAt: session.revokedAt ? session.revokedAt.toISOString() : null
      }))
    });
  });

  adminRouter.post("/puzzles/import-from-bank", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    if (eventHasStarted(event)) {
      return res.status(409).json({ ok: false, message: "Puzzle bank import is disabled after the event starts." });
    }

    const bank = readPuzzleBank();
    const importSummary = await prisma.$transaction(async (tx) => {
      let createdCount = 0;
      let updatedCount = 0;
      let hintCount = 0;

      const existing = await tx.puzzle.findMany({
        where: { eventId: event.id },
        select: { id: true, slug: true }
      });
      const bySlug = new Map(existing.map((row) => [row.slug, row]));

      for (let index = 0; index < bank.length; index += 1) {
        const item = bank[index];
        const payload = {
          eventId: event.id,
          slug: `${item.slug}`,
          title: `${item.title}`,
          type: `${item.type}`,
          prompt: `${item.prompt}`,
          answerKey: normalizeAnswer(item.answerKey),
          orderIndex: index + 1,
          hintPenaltySeconds: 0,
          builtinUtils: Array.isArray(item.builtinUtils) ? item.builtinUtils : [],
          externalLinks: Array.isArray(item.externalLinks) ? item.externalLinks : [],
          isInspectPuzzle: Boolean(item.isInspectPuzzle),
          isolatedUrl: item.isolatedUrl ? `${item.isolatedUrl}` : null
        };

        let puzzle;
        const prev = bySlug.get(payload.slug);
        if (prev) {
          puzzle = await tx.puzzle.update({
            where: { id: prev.id },
            data: payload
          });
          updatedCount += 1;
        } else {
          puzzle = await tx.puzzle.create({
            data: payload
          });
          createdCount += 1;
        }

        await tx.puzzleHint.deleteMany({
          where: { puzzleId: puzzle.id }
        });

        const hints = normalizeHintRowsForImport(puzzle.id, item.hints);
        if (hints.length > 0) {
          await tx.puzzleHint.createMany({ data: hints });
          hintCount += hints.length;
        }
      }

      const bankSlugSet = new Set(bank.map((item) => `${item.slug}`));
      const staleIds = existing.filter((row) => !bankSlugSet.has(row.slug)).map((row) => row.id);

      if (staleIds.length > 0) {
        await tx.puzzleHint.deleteMany({
          where: { puzzleId: { in: staleIds } }
        });
        await tx.puzzle.deleteMany({
          where: { id: { in: staleIds } }
        });
      }

      return {
        totalInBank: bank.length,
        createdCount,
        updatedCount,
        deletedCount: staleIds.length,
        hintCount
      };
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "import_puzzle_bank",
      entityType: "puzzle_bank",
      entityId: event.id,
      details: importSummary
    });

    return res.json({ ok: true, ...importSummary });
  });

  adminRouter.post("/puzzles", async (req, res) => {
    try {
      const parsed = parseBody(AdminPuzzleCreateSchema, req.body);
      if (!parsed.ok) {
        return res.status(parsed.status).json({ ok: false, message: parsed.message });
      }

      const event = await getActiveEvent(prisma);
      if (!event) {
        return res.status(404).json({ ok: false, message: "No active event configured." });
      }

      let targetTeam = null;
      if (parsed.data.targetTeamId) {
        return res.status(400).json({
          ok: false,
          message: "Team-specific puzzle assignment is not supported with frozen event orders."
        });
      }

      const duplicate = await prisma.puzzle.findUnique({
        where: { slug: parsed.data.slug }
      });
      if (duplicate) {
        return res.status(409).json({ ok: false, message: "Puzzle slug already exists." });
      }

      const uniqueTiers = new Set(parsed.data.hints.map((hint) => hint.tier));
      if (uniqueTiers.size !== 3) {
        return res.status(400).json({ ok: false, message: "Hints must include unique tier1, tier2, and tier3 entries." });
      }

      const eventPuzzles = await prisma.puzzle.findMany({ where: { eventId: event.id } });
      const nextOrderIndex =
        eventPuzzles.reduce((maxValue, row) => Math.max(maxValue, Number(row.orderIndex || 0)), 0) + 1;
      let assignedTeamCount = 0;

      const created = await prisma.$transaction(async (tx) => {
        const puzzle = await tx.puzzle.create({
          data: {
            eventId: event.id,
            slug: parsed.data.slug,
            title: parsed.data.title,
            type: parsed.data.type,
            prompt: parsed.data.prompt,
            answerKey: normalizeAnswer(parsed.data.answerKey),
            orderIndex: nextOrderIndex,
            hintPenaltySeconds: 0,
            builtinUtils: parsed.data.builtinUtils,
            externalLinks: parsed.data.externalLinks,
            isInspectPuzzle: parsed.data.isInspectPuzzle,
            isolatedUrl: parsed.data.isInspectPuzzle ? parsed.data.isolatedUrl || null : null
          }
        });

        await tx.puzzleHint.createMany({
          data: parsed.data.hints.map((hint) => ({
            puzzleId: puzzle.id,
            tier: hint.tier,
            content: hint.content,
            penaltySeconds: hintPenaltyPointsForTier(hint.tier)
          }))
        });

        const allTeams = await tx.team.findMany({
          select: {
            id: true,
            isAdmin: true
          }
        });
        assignedTeamCount = allTeams.filter((row) => !row.isAdmin).length;

        return puzzle;
      });

      await appendAdminAudit(prisma, {
        adminTeamId: req.auth.team.id,
        action: "create_puzzle_manual",
        entityType: "puzzle",
        entityId: created.id,
        details: {
          slug: created.slug,
          title: created.title,
          type: created.type,
          orderIndex: created.orderIndex,
          assignedTeamCount,
          targetTeamId: targetTeam?.id || null,
          targetTeamCode: targetTeam?.code || null
        }
      });

      return res.status(201).json({
        ok: true,
        puzzle: {
          id: created.id,
          slug: created.slug,
          title: created.title,
          type: created.type,
          orderIndex: created.orderIndex
        },
        assignedTeamCount,
        targetTeam: targetTeam
          ? {
              id: targetTeam.id,
              code: targetTeam.code,
              name: targetTeam.name
            }
          : null
      });
    } catch (error) {
      console.error("Admin puzzle creation failed", error);
      return res.status(500).json({
        ok: false,
        message: "Unable to create puzzle right now. Please try again."
      });
    }
  });

  const uploadMiddleware = (field, maxCount = 1) => (req, res, next) => {
    const handler = maxCount > 1 ? adminAssetUpload.array(field, maxCount) : adminAssetUpload.single(field);
    handler(req, res, (error) => {
      if (!error) {
        return next();
      }

      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          ok: false,
          message: `File too large. Max size is ${Math.floor(ADMIN_ASSET_UPLOAD_MAX_BYTES / (1024 * 1024))}MB.`
        });
      }

      return next(error);
    });
  };

  const resolvePuzzleForUpload = async (puzzleId) => {
    const puzzle = await prisma.puzzle.findUnique({ where: { id: puzzleId } });
    if (!puzzle) {
      return { ok: false, status: 404, message: "Puzzle not found." };
    }

    const event = await getActiveEvent(prisma);
    if (!event || puzzle.eventId !== event.id) {
      return { ok: false, status: 400, message: "Puzzle is not part of the active event." };
    }

    return { ok: true, puzzle };
  };

  const resolveTargetTeamForAssetUpload = async (requestedTeamIdRaw) => {
    const requestedTeamId = `${requestedTeamIdRaw || ""}`.trim();
    if (!requestedTeamId) {
      return { ok: true, team: null };
    }

    const targetTeam = await prisma.team.findUnique({ where: { id: requestedTeamId } });
    if (!targetTeam) {
      return { ok: false, status: 404, message: "Target team not found for asset restriction." };
    }

    if (targetTeam.isAdmin) {
      return { ok: false, status: 400, message: "Team-restricted assets cannot target admin teams." };
    }

    return { ok: true, team: targetTeam };
  };

  const persistUploadedAsset = ({ puzzle, file, targetTeam, uploadRole = "regular" }) => {
    if (!isAllowedUploadFile(file)) {
      throw new Error("Unsupported file type. Allowed extensions include txt, md, json, csv, html, py, js, css, pdf, zip, audio, image and related asset formats.");
    }

    const role = normalizeUploadRole(uploadRole);
    const fileName = applyUploadRoleToFileName(createStoredAssetFileName(file), role);
    const storedRelativePath = buildStoredAssetRelativePath(fileName, targetTeam?.id || null);
    const puzzleDir = resolveUploadPuzzleDir(puzzle.slug);
    const outputPath = path.join(puzzleDir, ...storedRelativePath.split("/"));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, file.buffer);

    const assetUrl =
      role === "solution"
        ? null
        : `/puzzle-assets/${encodeURIComponent(puzzle.slug)}?file=${encodeURIComponent(storedRelativePath)}`;
    return {
      name: fileName,
      relativePath: parseTeamPrivateAssetPath(storedRelativePath).displayRelativePath || storedRelativePath,
      storedRelativePath,
      mediaType: inferAssetMediaType(storedRelativePath),
      visibility: role === "solution" ? "validation" : targetTeam ? "team" : "shared",
      role,
      team: targetTeam
        ? {
            id: targetTeam.id,
            code: targetTeam.code,
            name: targetTeam.name
          }
        : null,
      url: assetUrl,
      mimeType: file.mimetype,
      sizeBytes: file.size
    };
  };

  adminRouter.post("/puzzles/:id/assets", uploadMiddleware("file", 1), async (req, res) => {
    const puzzleResult = await resolvePuzzleForUpload(req.params.id);
    if (!puzzleResult.ok) {
      return res.status(puzzleResult.status).json({ ok: false, message: puzzleResult.message });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ ok: false, message: "No file uploaded. Use form field name 'file'." });
    }

    const teamResult = await resolveTargetTeamForAssetUpload(req.body?.teamId);
    if (!teamResult.ok) {
      return res.status(teamResult.status).json({ ok: false, message: teamResult.message });
    }

    const uploadRole = normalizeUploadRole(req.body?.role);

    let asset;
    try {
      asset = persistUploadedAsset({
        puzzle: puzzleResult.puzzle,
        file,
        targetTeam: teamResult.team,
        uploadRole
      });
    } catch (error) {
      return res.status(400).json({ ok: false, message: error.message });
    }

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "upload_puzzle_asset",
      entityType: "puzzle",
      entityId: puzzleResult.puzzle.id,
      details: {
        slug: puzzleResult.puzzle.slug,
        fileName: asset.name,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        uploadRole: asset.role,
        targetTeamId: teamResult.team?.id || null,
        targetTeamCode: teamResult.team?.code || null
      }
    });

    return res.status(201).json({ ok: true, asset });
  });

  adminRouter.post("/puzzles/:id/assets/batch", uploadMiddleware("files", 20), async (req, res) => {
    const puzzleResult = await resolvePuzzleForUpload(req.params.id);
    if (!puzzleResult.ok) {
      return res.status(puzzleResult.status).json({ ok: false, message: puzzleResult.message });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      return res.status(400).json({ ok: false, message: "No files uploaded. Use form field name 'files'." });
    }

    const teamResult = await resolveTargetTeamForAssetUpload(req.body?.teamId);
    if (!teamResult.ok) {
      return res.status(teamResult.status).json({ ok: false, message: teamResult.message });
    }

    const uploadRole = normalizeUploadRole(req.body?.role);

    let assets;
    try {
      assets = files.map((file) =>
        persistUploadedAsset({
          puzzle: puzzleResult.puzzle,
          file,
          targetTeam: teamResult.team,
          uploadRole
        })
      );
    } catch (error) {
      return res.status(400).json({ ok: false, message: error.message });
    }

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "upload_puzzle_asset_batch",
      entityType: "puzzle",
      entityId: puzzleResult.puzzle.id,
      details: {
        slug: puzzleResult.puzzle.slug,
        fileCount: assets.length,
        files: assets.map((asset) => ({
          name: asset.name,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          role: asset.role
        })),
        uploadRole,
        targetTeamId: teamResult.team?.id || null,
        targetTeamCode: teamResult.team?.code || null
      }
    });

    return res.status(201).json({ ok: true, assets });
  });

  adminRouter.post("/puzzles/:id/assets/delete", async (req, res) => {
    const puzzleResult = await resolvePuzzleForUpload(req.params.id);
    if (!puzzleResult.ok) {
      return res.status(puzzleResult.status).json({ ok: false, message: puzzleResult.message });
    }

    const requestedFile = `${req.body?.file || ""}`.trim();
    if (!requestedFile) {
      return res.status(400).json({ ok: false, message: "Asset file path is required." });
    }

    const filePath = resolvePuzzleAssetFileForAdmin(puzzleResult.puzzle.slug, requestedFile);
    if (!filePath) {
      return res.status(404).json({ ok: false, message: "Asset file not found." });
    }

    const puzzleDir = resolveImportedPuzzleDir(puzzleResult.puzzle.slug);
    const storedRelativePath = path.relative(path.resolve(puzzleDir), filePath).split(path.sep).join("/");
    const parsedAsset = parseTeamPrivateAssetPath(storedRelativePath);
    const displayRelativePath = parsedAsset.displayRelativePath || storedRelativePath;

    fs.unlinkSync(filePath);
    removeEmptyParentDirectories(filePath, puzzleDir);

    const existingExternalLinks = Array.isArray(puzzleResult.puzzle.externalLinks)
      ? puzzleResult.puzzle.externalLinks
      : [];
    const nextExternalLinks = existingExternalLinks.filter(
      (link) => extractAssetFilePathFromUrl(link?.url) !== storedRelativePath
    );

    if (nextExternalLinks.length !== existingExternalLinks.length) {
      await prisma.puzzle.update({
        where: { id: puzzleResult.puzzle.id },
        data: { externalLinks: nextExternalLinks }
      });
    }

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "delete_puzzle_asset",
      entityType: "puzzle",
      entityId: puzzleResult.puzzle.id,
      details: {
        slug: puzzleResult.puzzle.slug,
        storedRelativePath,
        displayRelativePath,
        visibility: parsedAsset.isTeamPrivate ? "team" : "shared",
        removedExternalLinks: existingExternalLinks.length - nextExternalLinks.length
      }
    });

    return res.json({
      ok: true,
      asset: {
        relativePath: displayRelativePath,
        storedRelativePath,
        visibility: parsedAsset.isTeamPrivate ? "team" : "shared"
      },
      removedExternalLinks: existingExternalLinks.length - nextExternalLinks.length
    });
  });

  adminRouter.delete("/puzzles/:id", async (req, res) => {
    const event = await getActiveEvent(prisma);
    if (!event) {
      return res.status(404).json({ ok: false, message: "No active event configured." });
    }

    if (eventHasStarted(event)) {
      return res.status(409).json({ ok: false, message: "Deleting puzzles is disabled after the event starts." });
    }

    const puzzle = await prisma.puzzle.findUnique({ where: { id: req.params.id } });
    if (!puzzle || puzzle.eventId !== event.id) {
      return res.status(404).json({ ok: false, message: "Puzzle not found in active event." });
    }

    const summary = await prisma.$transaction(async (tx) => {
      const teamSets = await tx.teamPuzzleSet.findMany({ where: { eventId: event.id } });

      for (const set of teamSets) {
        const currentOrder = Array.isArray(set.puzzleOrder) ? set.puzzleOrder.map((id) => `${id}`) : [];
        const nextOrder = currentOrder.filter((id) => id !== puzzle.id);
        if (nextOrder.length !== currentOrder.length) {
          await tx.teamPuzzleSet.update({
            where: { id: set.id },
            data: { puzzleOrder: nextOrder }
          });
        }
      }

      await tx.puzzle.delete({ where: { id: puzzle.id } });

      const remaining = await tx.puzzle.findMany({
        where: { eventId: event.id },
        orderBy: { orderIndex: "asc" },
        select: { id: true }
      });

      if (remaining.length > 0) {
        await tx.puzzle.updateMany({
          where: { eventId: event.id },
          data: { orderIndex: { increment: 1000 } }
        });

        for (let index = 0; index < remaining.length; index += 1) {
          await tx.puzzle.update({
            where: { id: remaining[index].id },
            data: { orderIndex: index + 1 }
          });
        }
      }

      return {
        remainingCount: remaining.length,
        updatedTeamPools: teamSets.length
      };
    });

    const puzzleDir = resolveImportedPuzzleDir(puzzle.slug);
    if (puzzleDir && fs.existsSync(puzzleDir) && isPathInside(importedPuzzleRoot, puzzleDir)) {
      fs.rmSync(puzzleDir, { recursive: true, force: true });
    }

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "delete_puzzle_global",
      entityType: "puzzle",
      entityId: puzzle.id,
      details: {
        slug: puzzle.slug,
        title: puzzle.title,
        updatedTeamPools: summary.updatedTeamPools,
        remainingCount: summary.remainingCount
      }
    });

    return res.json({
      ok: true,
      deletedPuzzle: {
        id: puzzle.id,
        slug: puzzle.slug,
        title: puzzle.title
      },
      remainingCount: summary.remainingCount
    });
  });

  adminRouter.patch("/puzzles/:id", async (req, res) => {
    const parsed = parseBody(AdminPuzzleMetadataUpdateSchema, req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, message: parsed.message });
    }

    const puzzle = await prisma.puzzle.findUnique({ where: { id: req.params.id } });
    if (!puzzle) {
      return res.status(404).json({ ok: false, message: "Puzzle not found." });
    }

    const data = {};
    if (parsed.data.slug !== undefined) {
      const duplicate = await prisma.puzzle.findUnique({ where: { slug: parsed.data.slug } });
      if (duplicate && duplicate.id !== puzzle.id) {
        return res.status(409).json({ ok: false, message: "Puzzle slug already exists." });
      }
      data.slug = parsed.data.slug;
    }
    if (parsed.data.title !== undefined) {
      data.title = parsed.data.title;
    }
    if (parsed.data.type !== undefined) {
      data.type = parsed.data.type;
    }
    if (parsed.data.prompt !== undefined) {
      data.prompt = parsed.data.prompt;
    }
    if (parsed.data.answerKey !== undefined) {
      data.answerKey = normalizeAnswer(parsed.data.answerKey);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ ok: false, message: "No puzzle fields were provided for update." });
    }

    const updated = await prisma.puzzle.update({
      where: { id: puzzle.id },
      data
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "update_puzzle_metadata",
      entityType: "puzzle",
      entityId: updated.id,
      details: {
        updatedFields: Object.keys(data)
      }
    });

    return res.json({
      ok: true,
      puzzle: {
        id: updated.id,
        slug: updated.slug,
        title: updated.title,
        type: updated.type,
        prompt: updated.prompt,
        answerKey: updated.answerKey
      }
    });
  });

  adminRouter.get("/audit-logs", async (req, res) => {
    const requestedLimit = Number.parseInt(`${req.query.limit || "50"}`, 10);
    const limit = Number.isNaN(requestedLimit) ? 50 : Math.max(1, Math.min(200, requestedLimit));

    const rows = await prisma.adminAuditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        adminTeam: {
          select: {
            id: true,
            code: true,
            name: true
          }
        }
      }
    });

    return res.json({
      ok: true,
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        details: row.details,
        createdAt: row.createdAt.toISOString(),
        adminTeam: row.adminTeam
      }))
    });
  });

  adminRouter.get("/warnings", async (req, res) => {
    const requestedLimit = Number.parseInt(`${req.query.limit || "100"}`, 10);
    const limit = Number.isNaN(requestedLimit) ? 100 : Math.max(1, Math.min(500, requestedLimit));

    const rows = await prisma.antiCheatWarning.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        team: {
          select: {
            id: true,
            code: true,
            name: true,
            warningCount: true,
            isLocked: true,
            isBanned: true
          }
        }
      }
    });

    return res.json({
      ok: true,
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        detail: row.detail,
        warningNumber: row.warningNumber,
        createdAt: row.createdAt.toISOString(),
        team: row.team
      }))
    });
  });

  adminRouter.patch("/puzzles/:id/tool-config", async (req, res) => {
    const parsed = parseBody(AdminPuzzleToolConfigUpdateSchema, req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, message: parsed.message });
    }

    const puzzle = await prisma.puzzle.findUnique({ where: { id: req.params.id } });
    if (!puzzle) {
      return res.status(404).json({ ok: false, message: "Puzzle not found." });
    }

    const update = {
      builtinUtils: parsed.data.builtinUtils ?? puzzle.builtinUtils,
      externalLinks: parsed.data.externalLinks ?? puzzle.externalLinks,
      isInspectPuzzle: parsed.data.isInspectPuzzle ?? puzzle.isInspectPuzzle,
      isolatedUrl: parsed.data.isolatedUrl !== undefined ? parsed.data.isolatedUrl : puzzle.isolatedUrl
    };

    const updated = await prisma.puzzle.update({
      where: { id: puzzle.id },
      data: update
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "update_tool_config",
      entityType: "puzzle",
      entityId: updated.id,
      details: {
        builtinUtils: update.builtinUtils,
        externalLinksCount: Array.isArray(update.externalLinks) ? update.externalLinks.length : 0,
        isInspectPuzzle: update.isInspectPuzzle,
        isolatedUrl: update.isolatedUrl
      }
    });

    return res.json({ ok: true, toolConfig: mapToolConfig(updated) });
  });

  adminRouter.patch("/puzzles/:id/penalty", async (req, res) => {
    const parsed = parseBody(AdminPuzzlePenaltyUpdateSchema, req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, message: parsed.message });
    }

    const updated = await prisma.puzzle.update({
      where: { id: req.params.id },
      data: { hintPenaltySeconds: 0 }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "update_hint_penalty",
      entityType: "puzzle",
      entityId: updated.id,
      details: {
        hintPenaltySeconds: updated.hintPenaltySeconds
      }
    });

    return res.json({ ok: true, puzzleId: updated.id, hintPenaltySeconds: updated.hintPenaltySeconds });
  });

  adminRouter.patch("/hints/:id", async (req, res) => {
    const parsed = parseBody(AdminHintUpdateSchema, req.body);
    if (!parsed.ok) {
      return res.status(parsed.status).json({ ok: false, message: parsed.message });
    }

    const updated = await prisma.puzzleHint.update({
      where: { id: req.params.id },
      data: {
        content: parsed.data.content,
        penaltySeconds: parsed.data.penaltySeconds ?? undefined
      }
    });

    await appendAdminAudit(prisma, {
      adminTeamId: req.auth.team.id,
      action: "update_hint",
      entityType: "puzzle_hint",
      entityId: updated.id,
      details: {
        penaltySeconds: updated.penaltySeconds,
        contentLength: typeof updated.content === "string" ? updated.content.length : 0
      }
    });

    return res.json({ ok: true, hintId: updated.id });
  });

  app.use("/admin", adminRouter);

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (
      `${error?.message || ""}`.includes("At least 13 puzzles are required") ||
      `${error?.message || ""}`.includes("Unable to assign a unique puzzle pool")
    ) {
      return res.status(400).json({ ok: false, message: error.message });
    }
    return res.status(500).json({ ok: false, message: "Internal server error" });
  });

  return app;
}

