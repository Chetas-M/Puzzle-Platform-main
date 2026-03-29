import test from "node:test";
import assert from "node:assert/strict";
import { deriveRemainingSeconds, normalizeAnswer } from "../src/time.js";

test("deriveRemainingSeconds subtracts penalties from base time", () => {
  const now = new Date("2026-03-26T10:00:00.000Z");
  const eventEndsAt = new Date("2026-03-26T10:10:00.000Z");
  const remaining = deriveRemainingSeconds({ now, eventEndsAt, penaltiesSeconds: 120 });
  assert.equal(remaining, 480);
});

test("deriveRemainingSeconds never returns negative", () => {
  const now = new Date("2026-03-26T10:00:00.000Z");
  const eventEndsAt = new Date("2026-03-26T09:59:00.000Z");
  const remaining = deriveRemainingSeconds({ now, eventEndsAt, penaltiesSeconds: 120 });
  assert.equal(remaining, 0);
});

test("normalizeAnswer trims and uppercases", () => {
  assert.equal(normalizeAnswer("  HeLLo  "), "HELLO");
});
