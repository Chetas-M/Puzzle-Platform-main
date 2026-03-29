ALTER TABLE "Event"
ALTER COLUMN "wrongAnswerPenaltyMinutes" SET DEFAULT 0;

UPDATE "Event"
SET "wrongAnswerPenaltyMinutes" = 0
WHERE "wrongAnswerPenaltyMinutes" IS DISTINCT FROM 0;

ALTER TABLE "Puzzle"
ALTER COLUMN "hintPenaltySeconds" SET DEFAULT 0;

UPDATE "Puzzle"
SET "hintPenaltySeconds" = 0
WHERE "hintPenaltySeconds" IS DISTINCT FROM 0;
