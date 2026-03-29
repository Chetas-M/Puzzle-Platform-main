import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const manualUploadRoot = path.resolve(__dirname, "../puzzle_bank/imported/manual_uploads");

function pickSelectedFields(row, select) {
  if (!select) {
    return row;
  }

  const picked = {};
  for (const [key, enabled] of Object.entries(select)) {
    if (enabled) {
      picked[key] = row[key];
    }
  }
  return picked;
}

function createMockPrisma() {
  let id = 0;
  const nextId = () => `id_${++id}`;

  const state = {
    events: [
      {
        id: "event_1",
        name: "Test Event",
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 60 * 60 * 1000),
        startedAt: null,
        puzzleCount: 20,
        wrongAnswerPenaltyMinutes: 0,
        frozenPuzzleIds: [],
        isActive: true,
        isPaused: false,
        pausedAt: null,
        createdAt: new Date("2026-03-27T10:00:00.000Z")
      }
    ],
    teams: [
      {
        id: "team_admin",
        code: "ADMIN01",
        name: "Event Admin",
        isAdmin: true,
        warningCount: 0,
        isLocked: false,
        lockedAt: null,
        isBanned: false,
        bannedAt: null
      },
      {
        id: "team_1",
        code: "TEAM01",
        name: "Quantum Foxes",
        isAdmin: false,
        warningCount: 0,
        isLocked: false,
        lockedAt: null,
        isBanned: false,
        bannedAt: null
      },
      {
        id: "team_2",
        code: "TEAM02",
        name: "Cipher Wolves",
        isAdmin: false,
        warningCount: 0,
        isLocked: false,
        lockedAt: null,
        isBanned: false,
        bannedAt: null
      },
      {
        id: "team_3",
        code: "TEAM03",
        name: "Nova Owls",
        isAdmin: false,
        warningCount: 0,
        isLocked: false,
        lockedAt: null,
        isBanned: false,
        bannedAt: null
      }
    ],
    sessions: [],
    puzzles: Array.from({ length: 24 }).map((_, index) => ({
      id: `p_${index + 1}`,
      eventId: "event_1",
      slug: `puzzle-${index + 1}`,
      title: `Puzzle ${index + 1}`,
      type: "generic",
      prompt: `Solve puzzle ${index + 1}`,
      answerKey: `ANSWER${index + 1}`,
      orderIndex: index + 1,
      hintPenaltySeconds: 0,
      builtinUtils: ["cipherDecoder"],
      externalLinks: [],
      isInspectPuzzle: false,
      isolatedUrl: null,
      createdAt: new Date("2026-03-27T10:00:00.000Z"),
      updatedAt: new Date("2026-03-27T10:00:00.000Z")
    })),
    hints: [],
    puzzleSets: [],
    attempts: [],
    solves: [],
    sessionsById: new Map(),
    reveals: [],
    notepads: [],
    clipboard: [],
    adminAuditLogs: [],
    antiCheatWarnings: []
  };

  for (const puzzle of state.puzzles) {
    state.hints.push(
      {
        id: `hint1_${puzzle.id}`,
        puzzleId: puzzle.id,
        tier: "tier1",
        content: "Hint 1",
        penaltySeconds: 0
      },
      {
        id: `hint2_${puzzle.id}`,
        puzzleId: puzzle.id,
        tier: "tier2",
        content: "Hint 2",
        penaltySeconds: 1
      },
      {
        id: `hint3_${puzzle.id}`,
        puzzleId: puzzle.id,
        tier: "tier3",
        content: "Hint 3",
        penaltySeconds: 2
      }
    );
  }

  const prisma = {
    event: {
      findFirst: async ({ where } = {}) =>
        state.events.find((event) => {
          if (where?.isActive !== undefined && event.isActive !== where.isActive) {
            return false;
          }
          if (where?.id && event.id !== where.id) {
            return false;
          }
          return true;
        }) || null,
      update: async ({ where, data }) => {
        const index = state.events.findIndex((event) => event.id === where.id);
        state.events[index] = { ...state.events[index], ...data };
        return state.events[index];
      }
    },
    team: {
      findFirst: async ({ where } = {}) => {
        const codeMatch = where?.code?.equals ? `${where.code.equals}`.toLowerCase() : null;
        const nameMatch = where?.name?.equals ? `${where.name.equals}`.toLowerCase() : null;

        return (
          state.teams.find((team) => {
            if (codeMatch && team.code.toLowerCase() !== codeMatch) {
              return false;
            }
            if (nameMatch && team.name.toLowerCase() !== nameMatch) {
              return false;
            }
            return true;
          }) || null
        );
      },
      findMany: async ({ orderBy, select } = {}) => {
        let rows = [...state.teams];
        if (orderBy?.name === "asc") {
          rows.sort((left, right) => left.name.localeCompare(right.name));
        }
        return rows.map((row) => pickSelectedFields(row, select));
      },
      create: async ({ data }) => {
        const row = {
          id: nextId(),
          warningCount: 0,
          isLocked: false,
          lockedAt: null,
          isBanned: false,
          bannedAt: null,
          ...data
        };
        state.teams.push(row);
        return row;
      },
      findUnique: async ({ where }) => state.teams.find((team) => team.id === where.id) || null,
      update: async ({ where, data }) => {
        const index = state.teams.findIndex((team) => team.id === where.id);
        state.teams[index] = { ...state.teams[index], ...data };
        return state.teams[index];
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        state.teams = state.teams.map((team) => {
          if (where?.isAdmin !== undefined && team.isAdmin !== where.isAdmin) {
            return team;
          }
          count += 1;
          return { ...team, ...data };
        });
        return { count };
      }
    },
    teamSession: {
      create: async ({ data }) => {
        const row = {
          id: nextId(),
          createdAt: new Date(),
          revokedAt: null,
          ...data
        };
        state.sessions.push(row);
        state.sessionsById.set(row.id, row);
        return row;
      },
      count: async ({ where } = {}) =>
        state.sessions.filter((session) => {
          if (where?.teamId && session.teamId !== where.teamId) return false;
          if (where?.revokedAt === null && session.revokedAt !== null) return false;
          if (where?.expiresAt?.gt && !(session.expiresAt > where.expiresAt.gt)) return false;
          return true;
        }).length,
      findMany: async ({ where, include, orderBy, take } = {}) => {
        let rows = state.sessions.filter((session) => {
          if (where?.revokedAt === null && session.revokedAt !== null) return false;
          if (where?.expiresAt?.gt && !(session.expiresAt > where.expiresAt.gt)) return false;
          return true;
        });

        if (orderBy?.createdAt === "desc") {
          rows = rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }

        if (typeof take === "number") {
          rows = rows.slice(0, take);
        }

        if (include?.team) {
          return rows.map((row) => ({
            ...row,
            team: state.teams.find((team) => team.id === row.teamId) || null
          }));
        }

        return rows;
      },
      findFirst: async ({ where, orderBy, select } = {}) => {
        let rows = state.sessions.filter((session) => {
          if (where?.teamId && session.teamId !== where.teamId) return false;
          return true;
        });

        if (orderBy?.createdAt === "desc") {
          rows = rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }

        const row = rows[0] || null;
        return row ? pickSelectedFields(row, select) : null;
      },
      findUnique: async ({ where, include } = {}) => {
        const row = state.sessionsById.get(where.id) || null;
        if (!row) {
          return null;
        }
        if (include?.team) {
          return {
            ...row,
            team: state.teams.find((team) => team.id === row.teamId) || null
          };
        }
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.sessionsById.get(where.id);
        Object.assign(row, data);
        return row;
      }
    },
    teamPuzzleSet: {
      findMany: async ({ where, select } = {}) =>
        state.puzzleSets
          .filter((row) => !where?.eventId || row.eventId === where.eventId)
          .map((row) => pickSelectedFields(row, select)),
      findUnique: async ({ where }) => {
        const key = where.teamId_eventId;
        return (
          state.puzzleSets.find(
            (row) => row.teamId === key.teamId && row.eventId === key.eventId
          ) || null
        );
      },
      create: async ({ data }) => {
        const row = {
          id: nextId(),
          createdAt: new Date(),
          updatedAt: new Date(),
          currentPuzzleIndex: 0,
          ...data
        };
        state.puzzleSets.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const index = state.puzzleSets.findIndex((row) => row.id === where.id);
        state.puzzleSets[index] = {
          ...state.puzzleSets[index],
          ...data,
          updatedAt: new Date()
        };
        return state.puzzleSets[index];
      }
    },
    puzzle: {
      findMany: async ({ where, orderBy, select } = {}) => {
        let rows = [...state.puzzles];
        if (where?.eventId) {
          rows = rows.filter((row) => row.eventId === where.eventId);
        }
        if (where?.id?.in) {
          const wanted = new Set(where.id.in);
          rows = rows.filter((row) => wanted.has(row.id));
        }
        if (orderBy?.orderIndex === "asc") {
          rows.sort((left, right) => left.orderIndex - right.orderIndex);
        }
        return rows.map((row) => pickSelectedFields(row, select));
      },
      findFirst: async ({ where, include } = {}) => {
        const row = state.puzzles.find((puzzle) => {
          if (where?.eventId && puzzle.eventId !== where.eventId) {
            return false;
          }
          if (!Array.isArray(where?.OR)) {
            return false;
          }
          return where.OR.some(
            (clause) => (clause.id && clause.id === puzzle.id) || (clause.slug && clause.slug === puzzle.slug)
          );
        });
        if (!row) {
          return null;
        }
        if (include?.hints) {
          return {
            ...row,
            hints: state.hints.filter((hint) => hint.puzzleId === row.id)
          };
        }
        return row;
      },
      findUnique: async ({ where }) => {
        if (where?.id) {
          return state.puzzles.find((row) => row.id === where.id) || null;
        }
        if (where?.slug) {
          return state.puzzles.find((row) => row.slug === where.slug) || null;
        }
        return null;
      }
    },
    puzzleAttempt: {
      findMany: async ({ where, select } = {}) =>
        state.attempts
          .filter((row) => {
            if (where?.teamId && row.teamId !== where.teamId) return false;
            if (where?.puzzleId && row.puzzleId !== where.puzzleId) return false;
            if (where?.isCorrect !== undefined && row.isCorrect !== where.isCorrect) return false;
            return true;
          })
          .map((row) => pickSelectedFields(row, select)),
      count: async ({ where } = {}) =>
        state.attempts.filter((row) => {
          if (where?.teamId && row.teamId !== where.teamId) return false;
          if (where?.puzzleId && row.puzzleId !== where.puzzleId) return false;
          if (where?.isCorrect !== undefined && row.isCorrect !== where.isCorrect) return false;
          return true;
        }).length,
      create: async ({ data }) => {
        const row = {
          id: nextId(),
          createdAt: new Date(),
          ...data
        };
        state.attempts.push(row);
        return row;
      }
    },
    puzzleSolve: {
      findMany: async ({ where, select } = {}) =>
        state.solves
          .filter((row) => {
            if (where?.teamId && row.teamId !== where.teamId) return false;
            return true;
          })
          .map((row) => pickSelectedFields(row, select)),
      count: async ({ where } = {}) =>
        state.solves.filter((row) => {
          if (where?.teamId && row.teamId !== where.teamId) return false;
          return true;
        }).length,
      findUnique: async ({ where }) => {
        const key = where.teamId_puzzleId;
        return (
          state.solves.find((row) => row.teamId === key.teamId && row.puzzleId === key.puzzleId) || null
        );
      },
      upsert: async ({ where, create }) => {
        const key = where.teamId_puzzleId;
        const existing = state.solves.find((row) => row.teamId === key.teamId && row.puzzleId === key.puzzleId);
        if (existing) {
          return existing;
        }
        const row = {
          id: nextId(),
          solvedAt: new Date(),
          ...create
        };
        state.solves.push(row);
        return row;
      }
    },
    hintRevealAudit: {
      findMany: async ({ where, select } = {}) =>
        state.reveals
          .filter((row) => {
            if (where?.teamId && row.teamId !== where.teamId) return false;
            if (where?.puzzleId && row.puzzleId !== where.puzzleId) return false;
            return true;
          })
          .map((row) => pickSelectedFields(row, select)),
      create: async ({ data }) => {
        const row = { id: nextId(), createdAt: new Date(), ...data };
        state.reveals.push(row);
        return row;
      },
      findUnique: async ({ where }) => {
        const key = where.teamId_puzzleId_tier;
        return (
          state.reveals.find(
            (row) =>
              row.teamId === key.teamId &&
              row.puzzleId === key.puzzleId &&
              row.tier === key.tier
          ) || null
        );
      },
      aggregate: async ({ where }) => ({
        _sum: {
          penaltySeconds: state.reveals
            .filter((row) => !where?.teamId || row.teamId === where.teamId)
            .reduce((total, row) => total + Number(row.penaltySeconds || 0), 0)
        }
      })
    },
    adminAuditLog: {
      create: async ({ data }) => {
        const row = { id: nextId(), createdAt: new Date(), ...data };
        state.adminAuditLogs.push(row);
        return row;
      },
      findMany: async ({ orderBy, take } = {}) => {
        let rows = [...state.adminAuditLogs];
        if (orderBy?.createdAt === "desc") {
          rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
        if (typeof take === "number") {
          rows = rows.slice(0, take);
        }
        return rows;
      }
    },
    antiCheatWarning: {
      create: async ({ data }) => {
        const row = { id: nextId(), createdAt: new Date(), ...data };
        state.antiCheatWarnings.push(row);
        return row;
      },
      findMany: async ({ orderBy, take, include } = {}) => {
        let rows = [...state.antiCheatWarnings];
        if (orderBy?.createdAt === "desc") {
          rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
        }
        if (typeof take === "number") {
          rows = rows.slice(0, take);
        }
        if (include?.team) {
          return rows.map((row) => ({
            ...row,
            team: state.teams.find((team) => team.id === row.teamId) || null
          }));
        }
        return rows;
      }
    },
    $transaction: async (handler) => handler(prisma)
  };

  return { prisma, state };
}

function createHarness() {
  const { prisma, state } = createMockPrisma();
  const app = createApp({
    prisma,
    config: {
      WEB_ORIGIN: "http://localhost:5174",
      SESSION_SECRET: "integration-test-session-secret",
      COOKIE_NAME: "team_session",
      isProduction: false
    }
  });

  return {
    state,
    adminClient: request.agent(app),
    teamOneClient: request.agent(app),
    teamTwoClient: request.agent(app),
    teamThreeClient: request.agent(app),
    outsiderClient: request.agent(app),
    publicClient: request(app)
  };
}

async function login(client, teamCode, teamName) {
  const response = await client.post("/auth/team-session").send({ teamCode, teamName });
  assert.equal(response.status, 200);
  return response.body.team;
}

async function configureAndStart(adminClient, options = {}) {
  const settings = {
    puzzleCount: 20,
    ...options
  };
  const update = await adminClient.patch("/admin/event-settings").send(settings);
  assert.equal(update.status, 200);

  const start = await adminClient.post("/admin/event-start").send({});
  assert.equal(start.status, 200);
  return start.body;
}

function getTeamSet(state, teamId) {
  const row = state.puzzleSets.find((set) => set.teamId === teamId);
  assert.ok(row);
  return row;
}

function getPuzzle(state, puzzleId) {
  const row = state.puzzles.find((puzzle) => puzzle.id === puzzleId);
  assert.ok(row);
  return row;
}

function resetManualUploadPuzzleDir(slug) {
  const dirPath = path.join(manualUploadRoot, slug);
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

test("admin can configure and start the event with one frozen pool and unique team orders", async () => {
  const { state, adminClient, teamOneClient, teamTwoClient, teamThreeClient } = createHarness();

  await login(adminClient, "ADMIN01", "Event Admin");
  await login(teamOneClient, "TEAM01", "Quantum Foxes");
  await login(teamTwoClient, "TEAM02", "Cipher Wolves");
  await login(teamThreeClient, "TEAM03", "Nova Owls");

  const waiting = await teamOneClient.get("/puzzles");
  assert.equal(waiting.status, 200);
  assert.equal(waiting.body.isStarted, false);
  assert.equal(waiting.body.puzzles.length, 0);

  await configureAndStart(adminClient, {
    puzzleCount: 20
  });

  assert.ok(state.events[0].startedAt instanceof Date);
  assert.equal(state.events[0].frozenPuzzleIds.length, 20);
  assert.equal(state.puzzleSets.length, 3);

  const sets = ["team_1", "team_2", "team_3"].map((teamId) => getTeamSet(state, teamId));
  const sortedSignatures = sets.map((row) => [...row.puzzleOrder].sort().join("|"));
  const orderSignatures = sets.map((row) => row.puzzleOrder.join("|"));

  assert.equal(new Set(sortedSignatures).size, 1, "every team should use the same frozen puzzle set");
  assert.equal(new Set(orderSignatures).size, 3, "every team should receive a distinct order");
  assert.ok(sets.every((row) => row.currentPuzzleIndex === 0));

  const puzzles = await teamOneClient.get("/puzzles");
  assert.equal(puzzles.status, 200);
  assert.equal(puzzles.body.isStarted, true);
  assert.equal(puzzles.body.totalPuzzles, 20);
  assert.equal(puzzles.body.currentPuzzleId, sets[0].puzzleOrder[0]);
  assert.equal(puzzles.body.puzzles.length, 20);
  assert.deepEqual(puzzles.body.puzzles[0].toolConfig.builtinUtils, ["cipherDecoder"]);
  assert.deepEqual(puzzles.body.puzzles[1].toolConfig.builtinUtils, []);
});

test("event start is blocked when the requested puzzle count exceeds available puzzles", async () => {
  const { state, adminClient } = createHarness();

  await login(adminClient, "ADMIN01", "Event Admin");

  const update = await adminClient.patch("/admin/event-settings").send({
    puzzleCount: 26
  });
  assert.equal(update.status, 200);

  const start = await adminClient.post("/admin/event-start").send({});
  assert.equal(start.status, 400);
  assert.match(start.body.message, /At least 26 puzzles are required/);
  assert.equal(state.events[0].startedAt, null);
});

test("new participant registration is blocked after the event has started", async () => {
  const { adminClient, teamOneClient, outsiderClient } = createHarness();

  await login(adminClient, "ADMIN01", "Event Admin");
  await login(teamOneClient, "TEAM01", "Quantum Foxes");
  await configureAndStart(adminClient);

  const blocked = await outsiderClient.post("/auth/team-session").send({
    teamCode: "TEAM99",
    teamName: "Late Team"
  });

  assert.equal(blocked.status, 403);
  assert.match(blocked.body.message, /registration is closed/i);
});

test("answer submission is uppercased, current puzzle stays locked until explicit advance, and old puzzles stay inaccessible", async () => {
  const { state, adminClient, teamOneClient } = createHarness();

  await login(adminClient, "ADMIN01", "Event Admin");
  await login(teamOneClient, "TEAM01", "Quantum Foxes");
  await configureAndStart(adminClient);

  const teamSet = getTeamSet(state, "team_1");
  const currentPuzzleId = teamSet.puzzleOrder[0];
  const nextPuzzleId = teamSet.puzzleOrder[1];
  const answerKey = getPuzzle(state, currentPuzzleId).answerKey;

  const lockedNext = await teamOneClient.get(`/puzzles/${nextPuzzleId}`);
  assert.equal(lockedNext.status, 403);
  assert.equal(lockedNext.body.currentPuzzleId, currentPuzzleId);

  const submit = await teamOneClient.post(`/puzzles/${currentPuzzleId}/submit`).send({
    answer: answerKey.toLowerCase()
  });

  assert.equal(submit.status, 200);
  assert.equal(submit.body.result, "correct");
  assert.equal(submit.body.answer, answerKey);
  assert.equal(submit.body.canAdvance, true);
  assert.equal(submit.body.currentPuzzleId, currentPuzzleId);
  assert.equal(submit.body.currentPuzzleIndex, 0);
  assert.equal(state.attempts[0].answer, answerKey);
  assert.equal(state.attempts[0].isCorrect, true);

  const progressBeforeAdvance = await teamOneClient.get("/progress");
  assert.equal(progressBeforeAdvance.status, 200);
  assert.equal(progressBeforeAdvance.body.currentPuzzleId, currentPuzzleId);
  assert.equal(progressBeforeAdvance.body.canAdvance, true);
  assert.equal(progressBeforeAdvance.body.canSkip, false);

  const advance = await teamOneClient.post("/puzzles/current/advance").send({});
  assert.equal(advance.status, 200);
  assert.equal(advance.body.currentPuzzleId, nextPuzzleId);
  assert.equal(advance.body.currentPuzzleIndex, 1);
  assert.equal(getTeamSet(state, "team_1").currentPuzzleIndex, 1);

  const oldPuzzle = await teamOneClient.get(`/puzzles/${currentPuzzleId}`);
  assert.equal(oldPuzzle.status, 403);
  assert.equal(oldPuzzle.body.currentPuzzleId, nextPuzzleId);

  const refreshed = await teamOneClient.get("/puzzles");
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.body.currentPuzzleId, nextPuzzleId);
});

test("teams can skip an unsolved current puzzle after confirmation and cannot return to it", async () => {
  const { state, adminClient, teamOneClient } = createHarness();

  await login(adminClient, "ADMIN01", "Event Admin");
  await login(teamOneClient, "TEAM01", "Quantum Foxes");
  await configureAndStart(adminClient);

  const teamSet = getTeamSet(state, "team_1");
  const currentPuzzleId = teamSet.puzzleOrder[0];
  const nextPuzzleId = teamSet.puzzleOrder[1];

  const beforeSkip = await teamOneClient.get("/puzzles");
  assert.equal(beforeSkip.status, 200);
  assert.equal(beforeSkip.body.currentPuzzleId, currentPuzzleId);
  assert.equal(beforeSkip.body.canSkip, true);
  assert.equal(beforeSkip.body.canAdvance, false);

  const detailBeforeSkip = await teamOneClient.get(`/puzzles/${currentPuzzleId}`);
  assert.equal(detailBeforeSkip.status, 200);
  assert.equal(detailBeforeSkip.body.puzzle.progress.canSkip, true);

  const skip = await teamOneClient.post("/puzzles/current/skip").send({});
  assert.equal(skip.status, 200);
  assert.equal(skip.body.currentPuzzleId, nextPuzzleId);
  assert.equal(skip.body.currentPuzzleIndex, 1);
  assert.match(skip.body.message, /cannot return/i);
  assert.equal(getTeamSet(state, "team_1").currentPuzzleIndex, 1);

  const oldPuzzle = await teamOneClient.get(`/puzzles/${currentPuzzleId}`);
  assert.equal(oldPuzzle.status, 403);
  assert.equal(oldPuzzle.body.currentPuzzleId, nextPuzzleId);

  const afterSkip = await teamOneClient.get("/progress");
  assert.equal(afterSkip.status, 200);
  assert.equal(afterSkip.body.currentPuzzleId, nextPuzzleId);
  assert.equal(afterSkip.body.canSkip, true);
});

test("one team's solve does not mark the same puzzle as solved for another team", async () => {
  const { state, adminClient, teamOneClient, teamTwoClient } = createHarness();

  await login(adminClient, "ADMIN01", "Event Admin");
  await login(teamOneClient, "TEAM01", "Quantum Foxes");
  await login(teamTwoClient, "TEAM02", "Cipher Wolves");
  await configureAndStart(adminClient);

  const teamOnePuzzleId = getTeamSet(state, "team_1").puzzleOrder[0];
  const answerKey = getPuzzle(state, teamOnePuzzleId).answerKey;

  const solve = await teamOneClient.post(`/puzzles/${teamOnePuzzleId}/submit`).send({
    answer: answerKey
  });
  assert.equal(solve.status, 200);

  const teamTwoPuzzles = await teamTwoClient.get("/puzzles");
  assert.equal(teamTwoPuzzles.status, 200);
  const samePuzzleForTeamTwo = teamTwoPuzzles.body.puzzles.find((row) => row.id === teamOnePuzzleId);
  assert.ok(samePuzzleForTeamTwo);
  assert.equal(samePuzzleForTeamTwo.status, "unsolved");
});

test("fix-errors assets keep solution files hidden from participants and allow admins to delete them", async () => {
  const { state, adminClient, teamOneClient } = createHarness();

  state.puzzles[0].slug = "fix-errors-admin-asset-check";
  state.puzzles[0].type = "fix_errors";
  state.puzzles[0].builtinUtils = ["codeWorkspace", "pythonInterpreter", "codeVerifier"];

  const slug = state.puzzles[0].slug;
  const puzzleId = state.puzzles[0].id;
  const puzzleDir = resetManualUploadPuzzleDir(slug);

  fs.writeFileSync(path.join(puzzleDir, "buggy_code1.py"), "print('buggy')\n");
  fs.writeFileSync(path.join(puzzleDir, "solution1.py"), "print('fixed')\n");

  try {
    await login(adminClient, "ADMIN01", "Event Admin");
    await login(teamOneClient, "TEAM01", "Quantum Foxes");
    await configureAndStart(adminClient, { puzzleCount: 24 });

    const teamSet = getTeamSet(state, "team_1");
    const puzzleIndex = teamSet.puzzleOrder.indexOf(puzzleId);
    assert.notEqual(puzzleIndex, -1);
    teamSet.currentPuzzleIndex = puzzleIndex;

    const adminAssets = await adminClient.get(`/puzzles/${puzzleId}/assets`);
    assert.equal(adminAssets.status, 200);
    assert.deepEqual(
      adminAssets.body.items.map((item) => item.name).sort(),
      ["buggy_code1.py", "solution1.py"]
    );
    const hiddenAsset = adminAssets.body.items.find((item) => item.name === "solution1.py");
    assert.ok(hiddenAsset);
    assert.equal(hiddenAsset.role, "solution");
    assert.equal(hiddenAsset.storedRelativePath, "solution1.py");

    const participantAssets = await teamOneClient.get(`/puzzles/${puzzleId}/assets`);
    assert.equal(participantAssets.status, 200);
    assert.deepEqual(participantAssets.body.items.map((item) => item.name), ["buggy_code1.py"]);

    const blockedSolutionFetch = await teamOneClient.get(
      `/puzzle-assets/${encodeURIComponent(slug)}?file=${encodeURIComponent("solution1.py")}`
    );
    assert.equal(blockedSolutionFetch.status, 404);

    const adminSolutionFetch = await adminClient.get(
      `/puzzle-assets/${encodeURIComponent(slug)}?file=${encodeURIComponent("solution1.py")}`
    );
    assert.equal(adminSolutionFetch.status, 200);

    const deleteHiddenAsset = await adminClient.post(`/admin/puzzles/${puzzleId}/assets/delete`).send({
      file: hiddenAsset.storedRelativePath
    });
    assert.equal(deleteHiddenAsset.status, 200);
    assert.equal(fs.existsSync(path.join(puzzleDir, "solution1.py")), false);

    const adminAssetsAfterDelete = await adminClient.get(`/puzzles/${puzzleId}/assets`);
    assert.equal(adminAssetsAfterDelete.status, 200);
    assert.deepEqual(adminAssetsAfterDelete.body.items.map((item) => item.name), ["buggy_code1.py"]);
  } finally {
    fs.rmSync(puzzleDir, { recursive: true, force: true });
  }
});

test("time-up is computed server-side and blocks both submissions and puzzle advancement", async () => {
  const { state, adminClient, teamOneClient } = createHarness();

  await login(adminClient, "ADMIN01", "Event Admin");
  await login(teamOneClient, "TEAM01", "Quantum Foxes");
  await configureAndStart(adminClient);

  const teamSet = getTeamSet(state, "team_1");
  const currentPuzzleId = teamSet.puzzleOrder[0];
  const answerKey = getPuzzle(state, currentPuzzleId).answerKey;

  const solve = await teamOneClient.post(`/puzzles/${currentPuzzleId}/submit`).send({
    answer: answerKey
  });
  assert.equal(solve.status, 200);

  state.events[0].endsAt = new Date(Date.now() - 1000);

  const eventState = await teamOneClient.get("/event/state");
  assert.equal(eventState.status, 200);
  assert.equal(eventState.body.competition.isTimeUp, true);
  assert.equal(eventState.body.remainingSeconds, 0);

  const blockedSubmit = await teamOneClient.post(`/puzzles/${currentPuzzleId}/submit`).send({
    answer: answerKey
  });
  assert.equal(blockedSubmit.status, 423);
  assert.match(blockedSubmit.body.message, /Time is up/i);

  const blockedAdvance = await teamOneClient.post("/puzzles/current/advance").send({});
  assert.equal(blockedAdvance.status, 423);
  assert.match(blockedAdvance.body.message, /Time is up/i);
});

test("admin can end the event immediately and lock further team actions", async () => {
  const { state, adminClient, teamOneClient } = createHarness();

  await login(adminClient, "ADMIN01", "Event Admin");
  await login(teamOneClient, "TEAM01", "Quantum Foxes");
  await configureAndStart(adminClient);

  const teamSet = getTeamSet(state, "team_1");
  const currentPuzzleId = teamSet.puzzleOrder[0];

  const endEvent = await adminClient.post("/admin/event-end").send({});
  assert.equal(endEvent.status, 200);
  assert.equal(endEvent.body.competition.isTimeUp, true);
  assert.equal(state.events[0].isPaused, false);

  const eventState = await teamOneClient.get("/event/state");
  assert.equal(eventState.status, 200);
  assert.equal(eventState.body.competition.isTimeUp, true);

  const blockedSkip = await teamOneClient.post("/puzzles/current/skip").send({});
  assert.equal(blockedSkip.status, 423);
  assert.match(blockedSkip.body.message, /Time is up/i);

  const blockedSubmit = await teamOneClient.post(`/puzzles/${currentPuzzleId}/submit`).send({
    answer: getPuzzle(state, currentPuzzleId).answerKey
  });
  assert.equal(blockedSubmit.status, 423);
  assert.match(blockedSubmit.body.message, /Time is up/i);
});

test("public leaderboard is unauthenticated and ranks by solved count, then hint penalty points, then total time", async () => {
  const { state, adminClient, publicClient } = createHarness();

  await login(adminClient, "ADMIN01", "Event Admin");
  await configureAndStart(adminClient);

  const startMs = state.events[0].startsAt.getTime();
  const teamOneOrder = getTeamSet(state, "team_1").puzzleOrder;
  const teamTwoOrder = getTeamSet(state, "team_2").puzzleOrder;
  const teamThreeOrder = getTeamSet(state, "team_3").puzzleOrder;

  state.reveals.push({
    id: "reveal_team_1",
    teamId: "team_1",
    puzzleId: teamOneOrder[0],
    puzzleHintId: `hint2_${teamOneOrder[0]}`,
    tier: "tier2",
    penaltySeconds: 1,
    createdAt: new Date(startMs + 15_000)
  });

  state.solves.push(
    {
      id: "solve_team_1_a",
      teamId: "team_1",
      puzzleId: teamOneOrder[0],
      firstAttemptId: "attempt_team_1_a",
      solvedAt: new Date(startMs + 60_000)
    },
    {
      id: "solve_team_1_b",
      teamId: "team_1",
      puzzleId: teamOneOrder[1],
      firstAttemptId: "attempt_team_1_b",
      solvedAt: new Date(startMs + 90_000)
    },
    {
      id: "solve_team_2_a",
      teamId: "team_2",
      puzzleId: teamTwoOrder[0],
      firstAttemptId: "attempt_team_2_a",
      solvedAt: new Date(startMs + 40_000)
    },
    {
      id: "solve_team_2_b",
      teamId: "team_2",
      puzzleId: teamTwoOrder[1],
      firstAttemptId: "attempt_team_2_b",
      solvedAt: new Date(startMs + 80_000)
    },
    {
      id: "solve_team_3_a",
      teamId: "team_3",
      puzzleId: teamThreeOrder[0],
      firstAttemptId: "attempt_team_3_a",
      solvedAt: new Date(startMs + 10_000)
    },
    {
      id: "solve_team_3_b",
      teamId: "team_3",
      puzzleId: teamThreeOrder[1],
      firstAttemptId: "attempt_team_3_b",
      solvedAt: new Date(startMs + 20_000)
    }
  );

  const eventState = await publicClient.get("/public/event-state");
  assert.equal(eventState.status, 200);
  assert.equal(eventState.body.event.isStarted, true);

  const leaderboard = await publicClient.get("/leaderboard");
  assert.equal(leaderboard.status, 200);
  assert.deepEqual(
    leaderboard.body.leaderboard.slice(0, 3).map((row) => row.team.code),
    ["TEAM03", "TEAM02", "TEAM01"]
  );
  assert.equal(leaderboard.body.leaderboard[0].points, 2);
  assert.equal(leaderboard.body.leaderboard[0].hintPenaltyPoints, 0);
  assert.equal(leaderboard.body.leaderboard[1].totalElapsedSeconds, 80);
  assert.equal(leaderboard.body.leaderboard[2].hintPenaltyPoints, 1);
});
