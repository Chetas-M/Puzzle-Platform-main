import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";

function createMockPrisma() {
  let id = 0;
  const nextId = () => `id_${++id}`;

  const state = {
    events: [
      {
        id: "event_1",
        name: "Test Event",
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
        isActive: true,
        isPaused: false,
        pausedAt: null,
        createdAt: new Date()
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
      }
    ],
    sessions: [],
    puzzles: Array.from({ length: 10 }).map((_, idx) => ({
      id: `p_${idx + 1}`,
      eventId: "event_1",
      slug: `puzzle-${idx + 1}`,
      title: `Puzzle ${idx + 1}`,
      type: "generic",
      prompt: "Solve it",
      answerKey: idx === 0 ? "ORBIT" : `A${idx + 1}`,
      orderIndex: idx + 1,
      hintPenaltySeconds: 60,
      builtinUtils: ["cipherDecoder"],
      externalLinks: [],
      isInspectPuzzle: idx === 4,
      isolatedUrl: idx === 4 ? "/challenge/puzzle-5" : null,
      createdAt: new Date(),
      updatedAt: new Date()
    })),
    hints: [],
    puzzleSets: [],
    attempts: [],
    solves: [],
    notepads: [],
    clipboard: [],
    reveals: [],
    adminAuditLogs: [],
    antiCheatWarnings: []
  };

  for (const puzzle of state.puzzles) {
    state.hints.push(
      {
        id: `h1_${puzzle.id}`,
        puzzleId: puzzle.id,
        tier: "tier1",
        content: "Hint one",
        penaltySeconds: 0
      },
      {
        id: `h2_${puzzle.id}`,
        puzzleId: puzzle.id,
        tier: "tier2",
        content: "Hint two",
        penaltySeconds: 1
      },
      {
        id: `h3_${puzzle.id}`,
        puzzleId: puzzle.id,
        tier: "tier3",
        content: "Hint three",
        penaltySeconds: 2
      }
    );
  }

  const prisma = {
    event: {
      findFirst: async ({ where }) =>
        state.events.find((event) => event.isActive === where.isActive) || null,
      update: async ({ where, data }) => {
        const index = state.events.findIndex((event) => event.id === where.id);
        state.events[index] = { ...state.events[index], ...data };
        return state.events[index];
      }
    },
    team: {
      findFirst: async ({ where }) => {
        const codeMatch = where?.code?.equals?.toLowerCase();
        const nameMatch = where?.name?.equals?.toLowerCase();

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
      findMany: async () => [...state.teams].sort((a, b) => a.name.localeCompare(b.name)),
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
        const row = { id: nextId(), createdAt: new Date(), ...data, revokedAt: null };
        state.sessions.push(row);
        return row;
      },
      count: async ({ where }) =>
        state.sessions.filter((session) => {
          if (where?.teamId && session.teamId !== where.teamId) return false;
          if (where?.revokedAt === null && session.revokedAt !== null) return false;
          if (where?.expiresAt?.gt && !(session.expiresAt > where.expiresAt.gt)) return false;
          return true;
        }).length,
      findMany: async ({ where, include, orderBy, take }) => {
        let rows = state.sessions.filter((session) => {
          if (where?.revokedAt === null && session.revokedAt !== null) return false;
          if (where?.expiresAt?.gt && !(session.expiresAt > where.expiresAt.gt)) return false;
          return true;
        });

        if (orderBy?.createdAt === "desc") {
          rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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
      findFirst: async ({ where, orderBy, select }) => {
        let rows = state.sessions.filter((session) => {
          if (where?.teamId && session.teamId !== where.teamId) return false;
          return true;
        });

        if (orderBy?.createdAt === "desc") {
          rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }

        const row = rows[0] || null;
        if (!row) return null;
        if (!select) return row;

        return {
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
          revokedAt: row.revokedAt
        };
      },
      findUnique: async ({ where, include }) => {
        const row = state.sessions.find((session) => session.id === where.id) || null;
        if (!row) return null;
        if (!include?.team) return row;
        return { ...row, team: state.teams.find((team) => team.id === row.teamId) || null };
      },
      update: async ({ where, data }) => {
        const index = state.sessions.findIndex((session) => session.id === where.id);
        state.sessions[index] = { ...state.sessions[index], ...data };
        return state.sessions[index];
      }
    },
    teamPuzzleSet: {
      findMany: async ({ where, select } = {}) => {
        let rows = [...state.puzzleSets];
        if (where?.eventId) {
          rows = rows.filter((set) => set.eventId === where.eventId);
        }

        if (!select) {
          return rows;
        }

        return rows.map((row) => {
          const picked = {};
          for (const [key, enabled] of Object.entries(select)) {
            if (enabled) {
              picked[key] = row[key];
            }
          }
          return picked;
        });
      },
      findUnique: async ({ where }) => {
        const key = where.teamId_eventId;
        return (
          state.puzzleSets.find(
            (set) => set.teamId === key.teamId && set.eventId === key.eventId
          ) || null
        );
      },
      create: async ({ data }) => {
        const row = { id: nextId(), createdAt: new Date(), updatedAt: new Date(), ...data };
        state.puzzleSets.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const index = state.puzzleSets.findIndex((set) => set.id === where.id);
        state.puzzleSets[index] = {
          ...state.puzzleSets[index],
          ...data,
          updatedAt: new Date()
        };
        return state.puzzleSets[index];
      }
    },
    hintRevealAudit: {
      aggregate: async ({ where }) => {
        const sum = state.reveals
          .filter((entry) => entry.teamId === where.teamId)
          .reduce((acc, item) => acc + item.penaltySeconds, 0);
        return { _sum: { penaltySeconds: sum } };
      },
      findMany: async ({ where, select } = {}) => {
        let rows = state.reveals.filter((entry) => {
          if (where?.teamId && entry.teamId !== where.teamId) return false;
          if (where?.puzzleId && entry.puzzleId !== where.puzzleId) return false;
          return true;
        });

        if (!select) {
          return rows;
        }

        return rows.map((row) => {
          const picked = {};
          for (const [key, enabled] of Object.entries(select)) {
            if (enabled) {
              picked[key] = row[key];
            }
          }
          return picked;
        });
      },
      findUnique: async ({ where }) => {
        const key = where.teamId_puzzleId_tier;
        return (
          state.reveals.find(
            (entry) =>
              entry.teamId === key.teamId && entry.puzzleId === key.puzzleId && entry.tier === key.tier
          ) || null
        );
      },
      create: async ({ data }) => {
        const row = { id: nextId(), createdAt: new Date(), ...data };
        state.reveals.push(row);
        return row;
      }
    },
    puzzle: {
      findMany: async ({ where, orderBy, select } = {}) => {
        let rows = [...state.puzzles];

        if (where?.eventId) {
          rows = rows.filter((puzzle) => puzzle.eventId === where.eventId);
        }

        if (where?.id?.in) {
          const wanted = new Set(where.id.in);
          rows = rows.filter((puzzle) => wanted.has(puzzle.id));
        }

        if (orderBy?.orderIndex === "asc") {
          rows.sort((a, b) => a.orderIndex - b.orderIndex);
        }

        if (select?.id) {
          return rows.map((row) => {
            if (select.slug) {
              return { id: row.id, slug: row.slug };
            }
            return { id: row.id };
          });
        }

        return rows;
      },
      findFirst: async ({ where, include }) => {
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
        if (!row) return null;
        if (!include?.hints) return row;
        return { ...row, hints: state.hints.filter((hint) => hint.puzzleId === row.id) };
      },
      findUnique: async ({ where }) => {
        if (where?.id) {
          return state.puzzles.find((puzzle) => puzzle.id === where.id) || null;
        }

        if (where?.slug) {
          return state.puzzles.find((puzzle) => puzzle.slug === where.slug) || null;
        }

        return null;
      },
      create: async ({ data }) => {
        const row = {
          id: nextId(),
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data
        };
        state.puzzles.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const index = state.puzzles.findIndex((puzzle) => puzzle.id === where.id);
        state.puzzles[index] = { ...state.puzzles[index], ...data };
        return state.puzzles[index];
      },
      deleteMany: async ({ where }) => {
        const ids = new Set(where?.id?.in || []);
        state.puzzles = state.puzzles.filter((puzzle) => !ids.has(puzzle.id));
        return { count: ids.size };
      }
    },
    puzzleHint: {
      createMany: async ({ data }) => {
        for (const item of data) {
          state.hints.push({ id: nextId(), ...item });
        }
        return { count: data.length };
      },
      deleteMany: async ({ where }) => {
        if (where?.puzzleId) {
          state.hints = state.hints.filter((hint) => hint.puzzleId !== where.puzzleId);
          return { count: 1 };
        }

        if (where?.puzzleId?.in) {
          const ids = new Set(where.puzzleId.in);
          state.hints = state.hints.filter((hint) => !ids.has(hint.puzzleId));
          return { count: ids.size };
        }

        return { count: 0 };
      },
      update: async ({ where, data }) => {
        const index = state.hints.findIndex((hint) => hint.id === where.id);
        state.hints[index] = { ...state.hints[index], ...data };
        return state.hints[index];
      }
    },
    puzzleAttempt: {
      findMany: async ({ where }) => state.attempts.filter((item) => item.teamId === where.teamId),
      count: async ({ where }) =>
        state.attempts.filter((item) => {
          if (where?.teamId && item.teamId !== where.teamId) return false;
          if (where?.puzzleId && item.puzzleId !== where.puzzleId) return false;
          return true;
        }).length,
      create: async ({ data }) => {
        const row = { id: nextId(), createdAt: new Date(), ...data };
        state.attempts.push(row);
        return row;
      }
    },
    puzzleSolve: {
      findMany: async ({ where }) => state.solves.filter((item) => item.teamId === where.teamId),
      count: async ({ where }) =>
        state.solves.filter((item) => {
          if (where?.teamId && item.teamId !== where.teamId) return false;
          return true;
        }).length,
      findUnique: async ({ where }) => {
        const key = where.teamId_puzzleId;
        return (
          state.solves.find((item) => item.teamId === key.teamId && item.puzzleId === key.puzzleId) || null
        );
      },
      upsert: async ({ where, create }) => {
        const key = where.teamId_puzzleId;
        const existing = state.solves.find(
          (item) => item.teamId === key.teamId && item.puzzleId === key.puzzleId
        );
        if (existing) return existing;
        const row = { id: nextId(), solvedAt: new Date(), ...create };
        state.solves.push(row);
        return row;
      },
      deleteMany: async ({ where }) => {
        const before = state.solves.length;
        state.solves = state.solves.filter((item) => {
          if (where?.teamId && item.teamId !== where.teamId) return true;
          if (where?.puzzleId && item.puzzleId !== where.puzzleId) return true;
          return false;
        });
        return { count: before - state.solves.length };
      }
    },
    notepad: {
      findUnique: async ({ where }) => {
        const key = where.teamId_puzzleId;
        return (
          state.notepads.find((entry) => entry.teamId === key.teamId && entry.puzzleId === key.puzzleId) ||
          null
        );
      },
      upsert: async ({ where, create, update }) => {
        const key = where.teamId_puzzleId;
        const existing = state.notepads.find(
          (entry) => entry.teamId === key.teamId && entry.puzzleId === key.puzzleId
        );
        if (existing) {
          existing.content = update.content;
          existing.updatedAt = new Date();
          return existing;
        }

        const row = { id: nextId(), createdAt: new Date(), updatedAt: new Date(), ...create };
        state.notepads.push(row);
        return row;
      }
    },
    clipboardEntry: {
      findMany: async ({ where, orderBy, take }) => {
        const list = state.clipboard
          .filter((entry) => entry.teamId === where.teamId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return take ? list.slice(0, take) : list;
      },
      create: async ({ data }) => {
        const row = { id: nextId(), createdAt: new Date(), ...data };
        state.clipboard.push(row);
        return row;
      },
      deleteMany: async ({ where }) => {
        state.clipboard = state.clipboard.filter((entry) => !where.id.in.includes(entry.id));
        return { count: 1 };
      }
    },
    adminAuditLog: {
      create: async ({ data }) => {
        const row = { id: nextId(), createdAt: new Date(), ...data };
        state.adminAuditLogs.push(row);
        return row;
      },
      findMany: async ({ orderBy, take, include }) => {
        let rows = [...state.adminAuditLogs];
        if (orderBy?.createdAt === "desc") {
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (typeof take === "number") {
          rows = rows.slice(0, take);
        }

        if (include?.adminTeam) {
          return rows.map((row) => ({
            ...row,
            adminTeam: state.teams.find((team) => team.id === row.adminTeamId) || null
          }));
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
      findMany: async ({ orderBy, take, include }) => {
        let rows = [...state.antiCheatWarnings];
        if (orderBy?.createdAt === "desc") {
          rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
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

function createClient() {
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

  const client = request.agent(app);
  return { client, state };
}

async function getFirstUnlockedPuzzleId(client) {
  const puzzlesResponse = await client.get("/puzzles");
  assert.equal(puzzlesResponse.status, 200);
  assert.ok(Array.isArray(puzzlesResponse.body.puzzles));
  assert.ok(puzzlesResponse.body.puzzles.length > 0);
  return puzzlesResponse.body.puzzles[0].id;
}

test("team session creation and auth guard behavior", async () => {
  const { client } = createClient();

  const denied = await client.get("/event/state");
  assert.equal(denied.status, 401);

  const login = await client.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  assert.equal(login.status, 200);
  assert.equal(login.body.ok, true);

  const allowed = await client.get("/event/state");
  assert.equal(allowed.status, 200);
  assert.equal(typeof allowed.body.remainingSeconds, "number");
});

test("hint reveal applies penalty and audits once", async () => {
  const { client } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  const puzzleId = await getFirstUnlockedPuzzleId(client);

  const firstReveal = await client.post(`/puzzles/${puzzleId}/hints/tier1/reveal`);
  assert.equal(firstReveal.status, 200);
  assert.equal(firstReveal.body.penaltyAppliedPoints, 0);

  const secondReveal = await client.post(`/puzzles/${puzzleId}/hints/tier1/reveal`);
  assert.equal(secondReveal.status, 200);
  assert.equal(secondReveal.body.penaltyAppliedPoints, 0);
  assert.equal(secondReveal.body.totalPenaltyPoints, 0);

  const thirdReveal = await client.post(`/puzzles/${puzzleId}/hints/tier3/reveal`);
  assert.equal(thirdReveal.status, 200);
  assert.equal(thirdReveal.body.penaltyAppliedPoints, 2);
  assert.equal(thirdReveal.body.totalPenaltyPoints, 2);
});

test("submission lifecycle transitions progress", async () => {
  const { client, state } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  const puzzleId = await getFirstUnlockedPuzzleId(client);
  const selectedPuzzle = state.puzzles.find((row) => row.id === puzzleId);
  assert.ok(selectedPuzzle);

  const wrong = await client.post(`/puzzles/${puzzleId}/submit`).send({ answer: "WRONG" });
  assert.equal(wrong.status, 200);
  assert.equal(wrong.body.result, "incorrect");
  assert.equal(wrong.body.status, "attempted");

  const right = await client.post(`/puzzles/${puzzleId}/submit`).send({ answer: selectedPuzzle.answerKey });
  assert.equal(right.status, 200);
  assert.equal(right.body.result, "correct");
  assert.equal(right.body.status, "solved");
  assert.equal(typeof right.body.pointsAwarded, "number");
  assert.equal(typeof right.body.totalPoints, "number");

  const progress = await client.get("/progress");
  const item = progress.body.items.find((row) => row.puzzleId === puzzleId);
  assert.equal(item.status, "solved");
});

test("configured puzzle points are awarded once and leaderboard ranks teams", async () => {
  const { prisma, state } = createMockPrisma();
  state.teams.push({
    id: "team_2",
    code: "TEAM02",
    name: "Cipher Lynx",
    isAdmin: false,
    warningCount: 0,
    isLocked: false,
    lockedAt: null,
    isBanned: false,
    bannedAt: null
  });

  state.puzzles[0].type = "image_cipher";
  state.puzzles[1].type = "otp";
  state.puzzles[2].type = "audio_morse";

  const app = createApp({
    prisma,
    config: {
      WEB_ORIGIN: "http://localhost:5174",
      SESSION_SECRET: "integration-test-session-secret",
      COOKIE_NAME: "team_session",
      isProduction: false
    }
  });

  const teamOneClient = request.agent(app);
  const teamTwoClient = request.agent(app);

  await teamOneClient.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  await teamTwoClient.post("/auth/team-session").send({
    teamCode: "TEAM02",
    teamName: "Cipher Lynx"
  });

  const teamOneCorrect = await teamOneClient.post("/puzzles/p_1/submit").send({ answer: state.puzzles[0].answerKey });
  assert.equal(teamOneCorrect.status, 200);
  assert.equal(teamOneCorrect.body.result, "correct");
  assert.equal(teamOneCorrect.body.pointsAwarded, 2);
  assert.equal(teamOneCorrect.body.totalPoints, 2);

  const teamOneRepeat = await teamOneClient.post("/puzzles/p_1/submit").send({ answer: state.puzzles[0].answerKey });
  assert.equal(teamOneRepeat.status, 200);
  assert.equal(teamOneRepeat.body.pointsAwarded, 0);
  assert.equal(teamOneRepeat.body.totalPoints, 2);

  const teamTwoFirst = await teamTwoClient.post("/puzzles/p_2/submit").send({ answer: state.puzzles[1].answerKey });
  assert.equal(teamTwoFirst.status, 200);
  assert.equal(teamTwoFirst.body.pointsAwarded, 1);

  const teamTwoSecond = await teamTwoClient.post("/puzzles/p_3/submit").send({ answer: state.puzzles[2].answerKey });
  assert.equal(teamTwoSecond.status, 200);
  assert.equal(teamTwoSecond.body.pointsAwarded, 3);
  assert.equal(teamTwoSecond.body.totalPoints, 4);

  const leaderboard = await teamOneClient.get("/leaderboard");
  assert.equal(leaderboard.status, 200);
  assert.equal(leaderboard.body.ok, true);
  assert.equal(Array.isArray(leaderboard.body.leaderboard), true);
  assert.equal(leaderboard.body.leaderboard.length >= 2, true);
  assert.equal(leaderboard.body.leaderboard[0].team.code, "TEAM02");
  assert.equal(leaderboard.body.leaderboard[0].totalPoints, 4);
  assert.equal(leaderboard.body.leaderboard[1].team.code, "TEAM01");
  assert.equal(leaderboard.body.leaderboard[1].totalPoints, 2);
});

test("hint penalties reduce points and solved puzzles can be marked unsolved", async () => {
  const { client, state } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  const puzzleId = await getFirstUnlockedPuzzleId(client);
  const selectedPuzzle = state.puzzles.find((row) => row.id === puzzleId);
  assert.ok(selectedPuzzle);
  selectedPuzzle.type = "audio_morse";

  const secondHint = await client.post(`/puzzles/${puzzleId}/hints/tier2/reveal`);
  assert.equal(secondHint.status, 200);
  assert.equal(secondHint.body.penaltyAppliedPoints, 1);
  assert.equal(secondHint.body.totalPenaltyPoints, 1);

  const solved = await client.post(`/puzzles/${puzzleId}/submit`).send({ answer: selectedPuzzle.answerKey });
  assert.equal(solved.status, 200);
  assert.equal(solved.body.pointsAwarded, 3);
  assert.equal(solved.body.totalPoints, 2);

  const unsolved = await client.post(`/puzzles/${puzzleId}/unsolve`);
  assert.equal(unsolved.status, 200);
  assert.equal(unsolved.body.status, "attempted");
  assert.equal(unsolved.body.totalPoints, 0);

  const progress = await client.get("/progress");
  const item = progress.body.items.find((row) => row.puzzleId === puzzleId);
  assert.equal(item.status, "attempted");
});

test("clipboard keeps latest 5 entries", async () => {
  const { client } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  for (let i = 1; i <= 7; i += 1) {
    const response = await client.post("/clipboard").send({
      value: `entry-${i}`,
      source: "utility"
    });
    assert.equal(response.status, 200);
  }

  const clipboard = await client.get("/clipboard");
  assert.equal(clipboard.status, 200);
  assert.equal(clipboard.body.entries.length, 5);
  assert.equal(clipboard.body.entries[0].value, "entry-7");
  assert.equal(clipboard.body.entries[4].value, "entry-3");
});

test("admin endpoints require admin session and allow config updates", async () => {
  const { client } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  const forbidden = await client.patch("/admin/puzzles/p_1/penalty").send({
    hintPenaltySeconds: 90
  });
  assert.equal(forbidden.status, 403);

  await client.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const allowed = await client.patch("/admin/puzzles/p_1/penalty").send({
    hintPenaltySeconds: 90
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.hintPenaltySeconds, 90);

  const audit = await client.get("/admin/audit-logs?limit=10");
  assert.equal(audit.status, 200);
  assert.ok(Array.isArray(audit.body.items));
  assert.equal(audit.body.items.length > 0, true);
});

test("admin monitoring and puzzle import endpoints respond with operational data", async () => {
  const { client } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const monitorTeams = await client.get("/admin/teams/monitor");
  assert.equal(monitorTeams.status, 200);
  assert.equal(Array.isArray(monitorTeams.body.teams), true);
  assert.equal(monitorTeams.body.teams.length >= 1, true);

  const monitorSessions = await client.get("/admin/sessions/monitor");
  assert.equal(monitorSessions.status, 200);
  assert.equal(Array.isArray(monitorSessions.body.sessions), true);

  const importRes = await client.post("/admin/puzzles/import-from-bank");
  assert.equal(importRes.status, 200);
  assert.equal(importRes.body.ok, true);
  assert.equal(typeof importRes.body.totalInBank, "number");

  const audit = await client.get("/admin/audit-logs?limit=20");
  assert.equal(audit.status, 200);
  const hasImportAudit = audit.body.items.some((item) => item.action === "import_puzzle_bank");
  assert.equal(hasImportAudit, true);
});

test("admin can pause and resume timer for all teams", async () => {
  const { client } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const paused = await client.post("/admin/timer/pause-all");
  assert.equal(paused.status, 200);
  assert.equal(paused.body.isPaused, true);

  const eventStateWhilePaused = await client.get("/event/state");
  assert.equal(eventStateWhilePaused.status, 200);
  assert.equal(eventStateWhilePaused.body.competition.isPaused, true);

  const resumed = await client.post("/admin/timer/resume-all");
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.isPaused, false);

  const eventStateAfterResume = await client.get("/event/state");
  assert.equal(eventStateAfterResume.status, 200);
  assert.equal(eventStateAfterResume.body.competition.isPaused, false);
});

test("admin can ban and unban teams", async () => {
  const { prisma } = createMockPrisma();
  const app = createApp({
    prisma,
    config: {
      WEB_ORIGIN: "http://localhost:5174",
      SESSION_SECRET: "integration-test-session-secret",
      COOKIE_NAME: "team_session",
      isProduction: false
    }
  });
  const adminClient = request.agent(app);
  const participantClient = request.agent(app);

  await adminClient.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const banAll = await adminClient.post("/admin/teams/ban-all");
  assert.equal(banAll.status, 200);
  assert.equal(banAll.body.ok, true);

  await participantClient.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  const blocked = await participantClient.get("/puzzles");
  assert.equal(blocked.status, 423);

  const unbanAll = await adminClient.post("/admin/teams/unban-all");
  assert.equal(unbanAll.status, 200);
  assert.equal(unbanAll.body.ok, true);
});

test("anti-cheat warnings lock team after 3 violations", async () => {
  const { client } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  const v1 = await client.post("/anti-cheat/violation").send({
    type: "tab_out",
    detail: "first switch"
  });
  assert.equal(v1.status, 200);
  assert.equal(v1.body.enforcement.warnings, 1);
  assert.equal(v1.body.enforcement.isLocked, false);

  const v2 = await client.post("/anti-cheat/violation").send({
    type: "tab_out",
    detail: "second switch"
  });
  assert.equal(v2.status, 200);
  assert.equal(v2.body.enforcement.warnings, 2);
  assert.equal(v2.body.enforcement.isLocked, false);

  const v3 = await client.post("/anti-cheat/violation").send({
    type: "tab_out",
    detail: "third switch"
  });
  assert.equal(v3.status, 200);
  assert.equal(v3.body.enforcement.warnings, 3);
  assert.equal(v3.body.enforcement.isLocked, true);

  const state = await client.get("/event/state");
  assert.equal(state.status, 200);
  assert.equal(state.body.enforcement.isLocked, true);

  const denied = await client.get("/puzzles");
  assert.equal(denied.status, 423);
});

test("lifeline bypasses anti-cheat temporarily and ends on puzzle switch", async () => {
  const { client } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  const puzzleRows = await client.get("/puzzles");
  assert.equal(puzzleRows.status, 200);
  assert.equal(puzzleRows.body.puzzles.length >= 1, true);
  const firstPuzzleId = puzzleRows.body.puzzles[0].id;
  const secondPuzzleId = `${firstPuzzleId}__switched`;

  await client.post("/anti-cheat/violation").send({ type: "tab_out", detail: "1" });
  await client.post("/anti-cheat/violation").send({ type: "tab_out", detail: "2" });
  await client.post("/anti-cheat/violation").send({ type: "tab_out", detail: "3" });

  const locked = await client.get("/puzzles");
  assert.equal(locked.status, 423);

  const activate = await client.post("/lifeline/activate").send({ puzzleId: firstPuzzleId });
  assert.equal(activate.status, 200);
  assert.equal(activate.body.enforcement.lifelineActive, true);
  assert.equal(activate.body.enforcement.isLocked, false);

  const violationDuringLifeline = await client.post("/anti-cheat/violation").send({
    type: "window_blur",
    detail: "ignored",
    puzzleId: firstPuzzleId
  });
  assert.equal(violationDuringLifeline.status, 200);
  assert.equal(violationDuringLifeline.body.warningIssued, false);
  assert.equal(violationDuringLifeline.body.enforcement.lifelineActive, true);

  const allowedDuringLifeline = await client.get("/puzzles");
  assert.equal(allowedDuringLifeline.status, 200);

  const switched = await client.post("/lifeline/puzzle-switch").send({ puzzleId: secondPuzzleId });
  assert.equal(switched.status, 200);
  assert.equal(switched.body.cleared, true);
  assert.equal(switched.body.enforcement.lifelineActive, false);

  const blockedAfterSwitch = await client.get("/puzzles");
  assert.equal(blockedAfterSwitch.status, 423);
});

test("admin can unlock a locked team", async () => {
  const { prisma } = createMockPrisma();
  const app = createApp({
    prisma,
    config: {
      WEB_ORIGIN: "http://localhost:5174",
      SESSION_SECRET: "integration-test-session-secret",
      COOKIE_NAME: "team_session",
      isProduction: false
    }
  });

  const participantClient = request.agent(app);
  const adminClient = request.agent(app);

  await participantClient.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  await participantClient.post("/anti-cheat/violation").send({ type: "tab_out", detail: "1" });
  await participantClient.post("/anti-cheat/violation").send({ type: "tab_out", detail: "2" });
  await participantClient.post("/anti-cheat/violation").send({ type: "tab_out", detail: "3" });

  const blocked = await participantClient.get("/puzzles");
  assert.equal(blocked.status, 423);

  await adminClient.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const monitor = await adminClient.get("/admin/teams/monitor");
  const teamRow = monitor.body.teams.find((row) => row.code === "TEAM01");
  const unlock = await adminClient.post(`/admin/teams/${teamRow.id}/unlock`);
  assert.equal(unlock.status, 200);
  assert.equal(unlock.body.team.isLocked, false);
  assert.equal(unlock.body.team.warningCount, 0);

  const allowed = await participantClient.get("/puzzles");
  assert.equal(allowed.status, 200);
});

test("admin can view anti-cheat warning logs by team", async () => {
  const { prisma } = createMockPrisma();
  const app = createApp({
    prisma,
    config: {
      WEB_ORIGIN: "http://localhost:5174",
      SESSION_SECRET: "integration-test-session-secret",
      COOKIE_NAME: "team_session",
      isProduction: false
    }
  });

  const participantClient = request.agent(app);
  const adminClient = request.agent(app);

  await participantClient.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  const violation = await participantClient.post("/anti-cheat/violation").send({
    type: "tab_out",
    detail: "switched away"
  });
  assert.equal(violation.status, 200);

  await adminClient.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const warnings = await adminClient.get("/admin/warnings?limit=20");
  assert.equal(warnings.status, 200);
  assert.equal(Array.isArray(warnings.body.items), true);
  assert.equal(warnings.body.items.length > 0, true);
  assert.equal(warnings.body.items[0].team.code, "TEAM01");
});

test("teams receive unique pools of exactly 10 puzzles", async () => {
  const { prisma, state } = createMockPrisma();

  for (let index = 14; index <= 16; index += 1) {
    state.puzzles.push({
      id: `p_${index}`,
      eventId: "event_1",
      slug: `puzzle-${index}`,
      title: `Puzzle ${index}`,
      type: "generic",
      prompt: "Solve it",
      answerKey: `A${index}`,
      orderIndex: index,
      hintPenaltySeconds: 60,
      builtinUtils: ["cipherDecoder"],
      externalLinks: [],
      isInspectPuzzle: false,
      isolatedUrl: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    state.hints.push(
      {
        id: `h1_p_${index}`,
        puzzleId: `p_${index}`,
        tier: "tier1",
        content: "Hint one",
        penaltySeconds: 60
      },
      {
        id: `h2_p_${index}`,
        puzzleId: `p_${index}`,
        tier: "tier2",
        content: "Hint two",
        penaltySeconds: 120
      }
    );
  }

  const app = createApp({
    prisma,
    config: {
      WEB_ORIGIN: "http://localhost:5174",
      SESSION_SECRET: "integration-test-session-secret",
      COOKIE_NAME: "team_session",
      isProduction: false
    }
  });

  const teamOne = request.agent(app);
  const teamTwo = request.agent(app);

  const loginOne = await teamOne.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });
  assert.equal(loginOne.status, 200);

  const loginTwo = await teamTwo.post("/auth/team-session").send({
    teamCode: "TEAM02",
    teamName: "Cipher Wolves"
  });
  assert.equal(loginTwo.status, 200);

  const setOne = state.puzzleSets.find((set) => set.teamId === "team_1");
  const setTwo = state.puzzleSets.find((set) => set.teamId !== "team_1");
  assert.ok(setOne);
  assert.ok(setTwo);
  assert.equal(setOne.puzzleOrder.length, 10);
  assert.equal(setTwo.puzzleOrder.length, 10);
  assert.equal(new Set(setOne.puzzleOrder).size, 10);
  assert.equal(new Set(setTwo.puzzleOrder).size, 10);
  assert.notEqual(
    [...setOne.puzzleOrder].sort().join("|"),
    [...setTwo.puzzleOrder].sort().join("|"),
    "team pools should be unique"
  );
});

test("admin can create puzzle manually with required fields", async () => {
  const { client, state } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const response = await client.post("/admin/puzzles").send({
    slug: "manual-puzzle-alpha",
    title: "Manual Puzzle Alpha",
    type: "forensics",
    prompt: "Analyze the packet dump and submit the host value.",
    answerKey: "HOST42",
    hintPenaltySeconds: 75,
    builtinUtils: ["hexViewer", "encodingChain"],
    externalLinks: [
      {
        label: "Wireshark",
        url: "https://www.wireshark.org/"
      }
    ],
    isInspectPuzzle: false,
    isolatedUrl: null,
    hints: [
      { tier: "tier1", content: "Check DNS traffic first.", penaltySeconds: 60 },
      { tier: "tier2", content: "Look at uncommon query lengths.", penaltySeconds: 120 },
      { tier: "tier3", content: "Filter by suspicious hostnames.", penaltySeconds: 180 }
    ]
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.puzzle.slug, "manual-puzzle-alpha");

  const createdPuzzle = state.puzzles.find((row) => row.slug === "manual-puzzle-alpha");
  assert.ok(createdPuzzle);
  assert.equal(createdPuzzle.title, "Manual Puzzle Alpha");

  const createdHints = state.hints.filter((row) => row.puzzleId === createdPuzzle.id);
  assert.equal(createdHints.length, 3);

  const audit = state.adminAuditLogs.find((row) => row.action === "create_puzzle_manual");
  assert.ok(audit);
});

test("admin can create puzzle directly into a selected team pool", async () => {
  const { client, state } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const participant = state.teams.find((row) => row.code === "TEAM01");
  assert.ok(participant);

  const response = await client.post("/admin/puzzles").send({
    targetTeamId: participant.id,
    slug: "manual-puzzle-target-team",
    title: "Manual Puzzle Target Team",
    type: "forensics",
    prompt: "Create and attach only to one team pool.",
    answerKey: "TARGET",
    hintPenaltySeconds: 75,
    builtinUtils: ["hexViewer"],
    externalLinks: [],
    isInspectPuzzle: false,
    isolatedUrl: null,
    hints: [
      { tier: "tier1", content: "Tier 1", penaltySeconds: 60 },
      { tier: "tier2", content: "Tier 2", penaltySeconds: 120 },
      { tier: "tier3", content: "Tier 3", penaltySeconds: 180 }
    ]
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.targetTeam.id, participant.id);

  const createdPuzzle = state.puzzles.find((row) => row.slug === "manual-puzzle-target-team");
  assert.ok(createdPuzzle);

  const teamSet = state.puzzleSets.find((row) => row.teamId === participant.id);
  assert.ok(teamSet);
  assert.equal(teamSet.puzzleOrder.length, 10);
  assert.equal(teamSet.puzzleOrder.includes(createdPuzzle.id), true);

  const teamPool = await client.get(`/admin/teams/${participant.id}/puzzle-pool`);
  assert.equal(teamPool.status, 200);
  assert.equal(Array.isArray(teamPool.body.targetedItems), true);
  assert.equal(
    teamPool.body.targetedItems.some((item) => item.puzzleId === createdPuzzle.id),
    true
  );
});

test("admin can upload multiple assets for a puzzle", async () => {
  const { prisma } = createMockPrisma();
  const app = createApp({
    prisma,
    config: {
      WEB_ORIGIN: "http://localhost:5174",
      SESSION_SECRET: "integration-test-session-secret",
      COOKIE_NAME: "team_session",
      isProduction: false
    }
  });

  const adminClient = request.agent(app);
  const participantClient = request.agent(app);

  await adminClient.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const sharedUpload = await adminClient
    .post("/admin/puzzles/p_1/assets/batch")
    .attach("files", Buffer.from("shared-file"), {
      filename: "shared.txt",
      contentType: "text/plain"
    });

  assert.equal(sharedUpload.status, 201);
  assert.equal(sharedUpload.body.ok, true);

  const upload = await adminClient
    .post("/admin/puzzles/p_1/assets/batch")
    .field("teamId", "team_1")
    .attach("files", Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
      filename: "first.png",
      contentType: "image/png"
    })
    .attach("files", Buffer.from([0x52, 0x49, 0x46, 0x46]), {
      filename: "second.wav",
      contentType: "audio/wav"
    });

  assert.equal(upload.status, 201);
  assert.equal(upload.body.ok, true);
  assert.equal(Array.isArray(upload.body.assets), true);
  assert.equal(upload.body.assets.length, 2);
  assert.equal(upload.body.assets.every((row) => row.visibility === "team"), true);

  await participantClient.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });

  const assets = await participantClient.get("/puzzles/p_1/assets");
  assert.equal(assets.status, 200);
  assert.equal(Array.isArray(assets.body.items), true);
  assert.equal(assets.body.items.some((item) => item.visibility === "shared"), true);
  assert.equal(assets.body.items.some((item) => item.visibility === "team"), true);

  const sharedItem = assets.body.items.find((item) => item.visibility === "shared");
  const teamItem = assets.body.items.find((item) => item.visibility === "team");
  assert.ok(sharedItem?.url);
  assert.ok(teamItem?.url);

  const sharedDownload = await participantClient.get(sharedItem.url);
  const teamDownload = await participantClient.get(teamItem.url);
  assert.equal(sharedDownload.status, 200);
  assert.equal(teamDownload.status, 200);
});

test("admin can generate normal and temporary pools for a team", async () => {
  const { client, state } = createClient();

  for (let index = 14; index <= 16; index += 1) {
    state.puzzles.push({
      id: `p_${index}`,
      eventId: "event_1",
      slug: `puzzle-${index}`,
      title: `Puzzle ${index}`,
      type: "generic",
      prompt: "Solve it",
      answerKey: `A${index}`,
      orderIndex: index,
      hintPenaltySeconds: 60,
      builtinUtils: ["cipherDecoder"],
      externalLinks: [],
      isInspectPuzzle: false,
      isolatedUrl: null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  }

  await client.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const team = state.teams.find((row) => !row.isAdmin);
  assert.ok(team);

  const uniquePool = await client.post(`/admin/teams/${team.id}/puzzle-pool`).send({
    temporary: false
  });
  assert.equal(uniquePool.status, 200);
  assert.equal(uniquePool.body.ok, true);
  assert.equal(uniquePool.body.temporary, false);
  assert.equal(uniquePool.body.puzzleCount, 10);

  const temporaryPool = await client.post(`/admin/teams/${team.id}/puzzle-pool`).send({
    temporary: true
  });
  assert.equal(temporaryPool.status, 200);
  assert.equal(temporaryPool.body.ok, true);
  assert.equal(temporaryPool.body.temporary, true);
  assert.equal(temporaryPool.body.puzzleCount, 10);

  const hasUniqueAudit = state.adminAuditLogs.some((row) => row.action === "generate_team_pool");
  const hasTempAudit = state.adminAuditLogs.some((row) => row.action === "generate_temp_team_pool");
  assert.equal(hasUniqueAudit, true);
  assert.equal(hasTempAudit, true);
});

test("admin can view a team's puzzle pool", async () => {
  const { client, state } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const participant = state.teams.find((row) => row.code === "TEAM01");
  assert.ok(participant);

  const response = await client.get(`/admin/teams/${participant.id}/puzzle-pool`);
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.team.id, participant.id);
  assert.equal(Array.isArray(response.body.items), true);
  assert.equal(response.body.items.length, 10);
  assert.equal(Array.isArray(response.body.targetedItems), true);
});

test("admin can update puzzle metadata", async () => {
  const { client, state } = createClient();

  await client.post("/auth/team-session").send({
    teamCode: "ADMIN01",
    teamName: "Event Admin"
  });

  const target = state.puzzles[0];
  const response = await client.patch(`/admin/puzzles/${target.id}`).send({
    title: "Updated Puzzle Title",
    type: "updated_type",
    prompt: "Updated puzzle prompt for metadata test.",
    answerKey: "NEWKEY"
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.puzzle.id, target.id);
  assert.equal(response.body.puzzle.title, "Updated Puzzle Title");

  const persisted = state.puzzles.find((row) => row.id === target.id);
  assert.equal(persisted.title, "Updated Puzzle Title");
  assert.equal(persisted.answerKey, "NEWKEY");
});

test("team login falls back to temporary pool when unique pool is unavailable", async () => {
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

  const firstTeamClient = request.agent(app);
  const secondTeamClient = request.agent(app);

  const firstLogin = await firstTeamClient.post("/auth/team-session").send({
    teamCode: "TEAM01",
    teamName: "Quantum Foxes"
  });
  assert.equal(firstLogin.status, 200);

  const secondLogin = await secondTeamClient.post("/auth/team-session").send({
    teamCode: "TEAM02",
    teamName: "Cipher Wolves"
  });
  assert.equal(secondLogin.status, 200);

  const secondTeam = state.teams.find((row) => row.code === "TEAM02");
  assert.ok(secondTeam);

  const secondPool = state.puzzleSets.find((row) => row.teamId === secondTeam.id);
  assert.ok(secondPool);
  assert.equal(Array.isArray(secondPool.puzzleOrder), true);
  assert.equal(secondPool.puzzleOrder.length, 10);
});
