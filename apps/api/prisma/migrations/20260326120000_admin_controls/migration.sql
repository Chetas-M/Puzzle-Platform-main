-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "isPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "isBanned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "bannedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AntiCheatWarning" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "warningNumber" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AntiCheatWarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AntiCheatWarning_createdAt_idx" ON "AntiCheatWarning"("createdAt");

-- CreateIndex
CREATE INDEX "AntiCheatWarning_teamId_createdAt_idx" ON "AntiCheatWarning"("teamId", "createdAt");

-- AddForeignKey
ALTER TABLE "AntiCheatWarning" ADD CONSTRAINT "AntiCheatWarning_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
