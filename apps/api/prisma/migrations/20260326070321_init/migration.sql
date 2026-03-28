-- CreateTable
CREATE TABLE "TeamPuzzleSet" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "puzzleOrder" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamPuzzleSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamPuzzleSet_eventId_idx" ON "TeamPuzzleSet"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamPuzzleSet_teamId_eventId_key" ON "TeamPuzzleSet"("teamId", "eventId");

-- AddForeignKey
ALTER TABLE "TeamPuzzleSet" ADD CONSTRAINT "TeamPuzzleSet_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamPuzzleSet" ADD CONSTRAINT "TeamPuzzleSet_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
