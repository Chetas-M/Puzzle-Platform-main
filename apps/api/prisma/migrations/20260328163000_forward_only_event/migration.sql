-- AlterTable
ALTER TABLE "Event"
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "puzzleCount" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "wrongAnswerPenaltyMinutes" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "frozenPuzzleIds" JSONB;

-- AlterTable
ALTER TABLE "TeamPuzzleSet"
ADD COLUMN     "currentPuzzleIndex" INTEGER NOT NULL DEFAULT 0;

-- Data normalization
UPDATE "Puzzle"
SET "answerKey" = UPPER(TRIM("answerKey"))
WHERE "answerKey" IS NOT NULL;

UPDATE "PuzzleAttempt"
SET "answer" = UPPER(TRIM("answer"))
WHERE "answer" IS NOT NULL;
