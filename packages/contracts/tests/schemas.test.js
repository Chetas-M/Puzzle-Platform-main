import test from "node:test";
import assert from "node:assert/strict";
import {
  TeamSessionRequestSchema,
  ProgressResponseSchema,
  PuzzleToolConfigSchema
} from "../src/index.js";

test("team session request schema validates expected payload", () => {
  const parsed = TeamSessionRequestSchema.parse({
    teamCode: "ALPHA01",
    teamName: "Team Alpha"
  });

  assert.equal(parsed.teamCode, "ALPHA01");
  assert.equal(parsed.teamName, "Team Alpha");
});

test("progress response supports expanded navigation metadata", () => {
  const rows = Array.from({ length: 1 }).map((_, idx) => ({
    puzzleId: `p-${idx}`,
    title: `Puzzle ${idx}`,
    status: "unsolved"
  }));

  const parsed = ProgressResponseSchema.parse({
    ok: true,
    items: rows,
    currentPuzzleId: "p-0",
    currentPuzzleIndex: 0,
    totalPuzzles: 24,
    canAdvance: false,
    canSkip: true,
    isStarted: true,
    isFinished: false
  });
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.totalPuzzles, 24);
  assert.equal(parsed.canSkip, true);
});

test("tool config defaults are applied", () => {
  const parsed = PuzzleToolConfigSchema.parse({});
  assert.deepEqual(parsed.builtinUtils, []);
  assert.deepEqual(parsed.externalLinks, []);
  assert.equal(parsed.isInspectPuzzle, false);
  assert.equal(parsed.isolatedUrl, null);
});
