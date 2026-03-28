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

test("progress response supports up to 10 puzzle tiles", () => {
  const rows = Array.from({ length: 1 }).map((_, idx) => ({
    puzzleId: `p-${idx}`,
    title: `Puzzle ${idx}`,
    status: "unsolved"
  }));

  const parsed = ProgressResponseSchema.parse({ ok: true, items: rows });
  assert.equal(parsed.items.length, 1);
});

test("tool config defaults are applied", () => {
  const parsed = PuzzleToolConfigSchema.parse({});
  assert.deepEqual(parsed.builtinUtils, []);
  assert.deepEqual(parsed.externalLinks, []);
  assert.equal(parsed.isInspectPuzzle, false);
  assert.equal(parsed.isolatedUrl, null);
});
