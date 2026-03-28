import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const puzzleBankFile = path.resolve(__dirname, "../puzzle_bank/puzzles.json");

function loadPuzzleBank() {
  const raw = fs.readFileSync(puzzleBankFile, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("puzzle_bank/puzzles.json must contain a non-empty array.");
  }

  return parsed;
}

function buildHints(puzzleId, hintRows) {
  const fallback = [
    {
      tier: "tier1",
      content: "Start by normalizing all input text before transforming it.",
      penaltySeconds: 60
    },
    {
      tier: "tier2",
      content: "Focus on recurring symbols and position-based patterns.",
      penaltySeconds: 120
    },
    {
      tier: "tier3",
      content: "The final answer is uppercase and has no spaces.",
      penaltySeconds: 180
    }
  ];

  const source = Array.isArray(hintRows) && hintRows.length > 0 ? hintRows : fallback;
  return source.map((hint) => ({
    puzzleId,
    tier: `${hint.tier}`,
    content: `${hint.content}`,
    penaltySeconds: Number(hint.penaltySeconds || 0)
  }));
}

async function main() {
  const PUZZLES = loadPuzzleBank();

  await prisma.antiCheatWarning.deleteMany();
  await prisma.hintRevealAudit.deleteMany();
  await prisma.adminAuditLog.deleteMany();
  await prisma.clipboardEntry.deleteMany();
  await prisma.notepad.deleteMany();
  await prisma.puzzleSolve.deleteMany();
  await prisma.puzzleAttempt.deleteMany();
  await prisma.teamPuzzleSet.deleteMany();
  await prisma.puzzleHint.deleteMany();
  await prisma.puzzle.deleteMany();
  await prisma.teamSession.deleteMany();
  await prisma.team.deleteMany();
  await prisma.event.deleteMany();

  const startAt = new Date(process.env.EVENT_STARTS_AT || "2026-03-26T09:00:00.000Z");
  const durationSeconds = Number(process.env.EVENT_DURATION_SECONDS || 7200);
  const endAt = new Date(startAt.getTime() + durationSeconds * 1000);

  const event = await prisma.event.create({
    data: {
      name: "Puzzle Platform MVP Event",
      startsAt: startAt,
      endsAt: endAt,
      isActive: true
    }
  });

  const admin = await prisma.team.create({
    data: {
      code: "ADMIN01",
      name: "Event Admin",
      isAdmin: true
    }
  });

  await prisma.team.createMany({
    data: [
      { code: "TEAM01", name: "Quantum Foxes" },
      { code: "TEAM02", name: "Cipher Owls" },
      { code: "TEAM03", name: "Vector Lynx" }
    ]
  });

  for (let index = 0; index < PUZZLES.length; index += 1) {
    const item = PUZZLES[index];
    const puzzle = await prisma.puzzle.create({
      data: {
        eventId: event.id,
        slug: item.slug,
        title: item.title,
        type: item.type,
        prompt: item.prompt,
        answerKey: item.answerKey,
        orderIndex: index + 1,
        hintPenaltySeconds: 60,
        builtinUtils: item.builtinUtils,
        externalLinks: item.externalLinks,
        isInspectPuzzle: item.isInspectPuzzle,
        isolatedUrl: item.isolatedUrl
      }
    });

    await prisma.puzzleHint.createMany({
      data: buildHints(puzzle.id, item.hints)
    });
  }

  console.log(`Seed complete. Event ${event.id} with ${PUZZLES.length} puzzles. Admin: ${admin.code}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
