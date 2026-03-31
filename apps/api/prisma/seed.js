import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
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

async function confirmWipe() {
  if (process.argv.includes("--force")) {
    return;
  }

  const counts = {
    teams: await prisma.team.count(),
    puzzles: await prisma.puzzle.count(),
    solves: await prisma.puzzleSolve.count(),
    attempts: await prisma.puzzleAttempt.count()
  };

  console.log("\n\u26A0\uFE0F  WARNING: This will DELETE ALL existing data:");
  console.log(`   \u2022 ${counts.teams} teams`);
  console.log(`   \u2022 ${counts.puzzles} puzzles (including manually added ones)`);
  console.log(`   \u2022 ${counts.solves} solves`);
  console.log(`   \u2022 ${counts.attempts} attempts`);
  console.log("   \u2022 All sessions, hints, notepads, clipboard entries, audit logs\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question("Type YES to confirm: ", resolve);
  });
  rl.close();

  if (answer.trim() !== "YES") {
    console.log("Aborted. No changes made.");
    process.exit(0);
  }
}

async function main() {
  const PUZZLES = loadPuzzleBank();

  await confirmWipe();

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
      isActive: true,
      puzzleCount: 20,
      wrongAnswerPenaltyMinutes: 0
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
      { code: "TimeHackers101", name: "Time Hackers" },
      { code: "CtrlShiftElite102", name: "Ctrl Shift Elite" },
      { code: "AlooKiGang103", name: "Aloo Ki Gang" },
      { code: "NeonLogic104", name: "Neon Logic" },
      { code: "WizardsofAthens105", name: "Wizards of Athens" },
      { code: "CodeCrusadors106", name: "Code Crusadors" },
      { code: "TeamCoder107", name: "Team Coder" },
      { code: "ZeroDaySquad108", name: "Zero Day Squad" },
      { code: "TeamBang109", name: "Team Bang" },
      { code: "BinaryBrains110", name: "Binary Brains" },
      { code: "UNO111", name: "UNO" },
      { code: "TeamAyush112", name: "Team Ayush" },
      { code: "Castor113", name: "Castor" },
      { code: "Brute114", name: "Brute" },
      { code: "LalSarkar115", name: "Lal Sarkar" },
      { code: "BrainByte116", name: "Brain Byte" },
      { code: "TeamPhoenix117", name: "Team Phoenix" },
      { code: "MysteryMinds118", name: "Mystery Minds" },
      { code: "DevStorm119", name: "DevStorm" },
      { code: "TheRecursiveSquad120", name: "The Recursive Squad" },
      { code: "TechNerds121", name: "Tech Nerds" },
      { code: "HailMary122", name: "Hail Mary" },
      { code: "ERROR123", name: "ERROR" }
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
        answerKey: `${item.answerKey || ""}`.trim().toUpperCase(),
        orderIndex: index + 1,
        hintPenaltySeconds: 0,
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
