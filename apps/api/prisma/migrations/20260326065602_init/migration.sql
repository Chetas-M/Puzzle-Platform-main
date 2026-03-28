-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSession" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Puzzle" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "answerKey" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "hintPenaltySeconds" INTEGER NOT NULL DEFAULT 60,
    "builtinUtils" JSONB NOT NULL,
    "externalLinks" JSONB NOT NULL,
    "isInspectPuzzle" BOOLEAN NOT NULL DEFAULT false,
    "isolatedUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Puzzle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PuzzleHint" (
    "id" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "penaltySeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PuzzleHint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PuzzleAttempt" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PuzzleAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PuzzleSolve" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "solvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstAttemptId" TEXT,

    CONSTRAINT "PuzzleSolve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notepad" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notepad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClipboardEntry" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClipboardEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HintRevealAudit" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "puzzleId" TEXT NOT NULL,
    "puzzleHintId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "penaltySeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HintRevealAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_code_key" ON "Team"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Team_code_name_key" ON "Team"("code", "name");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSession_tokenId_key" ON "TeamSession"("tokenId");

-- CreateIndex
CREATE INDEX "TeamSession_teamId_idx" ON "TeamSession"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Puzzle_slug_key" ON "Puzzle"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Puzzle_eventId_orderIndex_key" ON "Puzzle"("eventId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "PuzzleHint_puzzleId_tier_key" ON "PuzzleHint"("puzzleId", "tier");

-- CreateIndex
CREATE INDEX "PuzzleAttempt_teamId_puzzleId_idx" ON "PuzzleAttempt"("teamId", "puzzleId");

-- CreateIndex
CREATE UNIQUE INDEX "PuzzleSolve_teamId_puzzleId_key" ON "PuzzleSolve"("teamId", "puzzleId");

-- CreateIndex
CREATE UNIQUE INDEX "Notepad_teamId_puzzleId_key" ON "Notepad"("teamId", "puzzleId");

-- CreateIndex
CREATE INDEX "ClipboardEntry_teamId_createdAt_idx" ON "ClipboardEntry"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "HintRevealAudit_teamId_createdAt_idx" ON "HintRevealAudit"("teamId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HintRevealAudit_teamId_puzzleId_tier_key" ON "HintRevealAudit"("teamId", "puzzleId", "tier");

-- AddForeignKey
ALTER TABLE "TeamSession" ADD CONSTRAINT "TeamSession_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Puzzle" ADD CONSTRAINT "Puzzle_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleHint" ADD CONSTRAINT "PuzzleHint_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleAttempt" ADD CONSTRAINT "PuzzleAttempt_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleAttempt" ADD CONSTRAINT "PuzzleAttempt_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleSolve" ADD CONSTRAINT "PuzzleSolve_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PuzzleSolve" ADD CONSTRAINT "PuzzleSolve_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notepad" ADD CONSTRAINT "Notepad_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notepad" ADD CONSTRAINT "Notepad_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClipboardEntry" ADD CONSTRAINT "ClipboardEntry_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HintRevealAudit" ADD CONSTRAINT "HintRevealAudit_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HintRevealAudit" ADD CONSTRAINT "HintRevealAudit_puzzleId_fkey" FOREIGN KEY ("puzzleId") REFERENCES "Puzzle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HintRevealAudit" ADD CONSTRAINT "HintRevealAudit_puzzleHintId_fkey" FOREIGN KEY ("puzzleHintId") REFERENCES "PuzzleHint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
