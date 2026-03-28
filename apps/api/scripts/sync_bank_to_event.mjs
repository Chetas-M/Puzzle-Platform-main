import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalizeHints(puzzleId, hintRows) {
  const fallback = [
    { tier: "tier1", content: "Start with the visible clues.", penaltySeconds: 60 },
    { tier: "tier2", content: "Focus on recurring patterns.", penaltySeconds: 120 },
    { tier: "tier3", content: "Verify final format before submit.", penaltySeconds: 180 }
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
  const repoRoot = process.cwd();
  const puzzleBankFile = path.resolve(repoRoot, "apps/api/puzzle_bank/puzzles.json");
  if (!fs.existsSync(puzzleBankFile)) {
    throw new Error(`Missing puzzle bank file: ${puzzleBankFile}`);
  }

  const bank = JSON.parse(fs.readFileSync(puzzleBankFile, "utf8"));
  if (!Array.isArray(bank) || bank.length === 0) {
    throw new Error("puzzles.json must contain a non-empty array.");
  }

  const event = await prisma.event.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "desc" }
  });

  if (!event) {
    throw new Error("No active event configured.");
  }

  const summary = await prisma.$transaction(async (tx) => {
    let createdCount = 0;
    let updatedCount = 0;
    let hintCount = 0;

    const existing = await tx.puzzle.findMany({
      where: { eventId: event.id },
      select: { id: true, slug: true }
    });
    const bySlug = new Map(existing.map((row) => [row.slug, row]));

    // Temporarily move existing order slots to avoid unique collisions while reindexing.
    if (existing.length > 0) {
      await tx.puzzle.updateMany({
        where: { eventId: event.id },
        data: { orderIndex: { increment: 1000 } }
      });
    }

    for (let index = 0; index < bank.length; index += 1) {
      const item = bank[index];
      const payload = {
        eventId: event.id,
        slug: `${item.slug}`,
        title: `${item.title}`,
        type: `${item.type}`,
        prompt: `${item.prompt}`,
        answerKey: `${item.answerKey}`,
        orderIndex: index + 1,
        hintPenaltySeconds: 60,
        builtinUtils: Array.isArray(item.builtinUtils) ? item.builtinUtils : [],
        externalLinks: Array.isArray(item.externalLinks) ? item.externalLinks : [],
        isInspectPuzzle: Boolean(item.isInspectPuzzle),
        isolatedUrl: item.isolatedUrl ? `${item.isolatedUrl}` : null
      };

      const prev = bySlug.get(payload.slug);
      let puzzle;
      if (prev) {
        puzzle = await tx.puzzle.update({ where: { id: prev.id }, data: payload });
        updatedCount += 1;
      } else {
        puzzle = await tx.puzzle.create({ data: payload });
        createdCount += 1;
      }

      await tx.puzzleHint.deleteMany({ where: { puzzleId: puzzle.id } });
      const hints = normalizeHints(puzzle.id, item.hints);
      if (hints.length > 0) {
        await tx.puzzleHint.createMany({ data: hints });
        hintCount += hints.length;
      }
    }

    const bankSlugSet = new Set(bank.map((item) => `${item.slug}`));
    const staleIds = existing.filter((row) => !bankSlugSet.has(row.slug)).map((row) => row.id);
    if (staleIds.length > 0) {
      await tx.puzzleHint.deleteMany({ where: { puzzleId: { in: staleIds } } });
      await tx.puzzle.deleteMany({ where: { id: { in: staleIds } } });
    }

    const resetSets = await tx.teamPuzzleSet.deleteMany({ where: { eventId: event.id } });

    return {
      totalInBank: bank.length,
      createdCount,
      updatedCount,
      deletedCount: staleIds.length,
      hintCount,
      teamSetResetCount: resetSets.count
    };
  });

  console.log(JSON.stringify({ ok: true, eventId: event.id, ...summary }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
