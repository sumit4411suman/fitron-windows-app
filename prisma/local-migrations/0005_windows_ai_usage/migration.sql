-- CreateTable
CREATE TABLE "WindowsAiUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "licenceId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "WindowsAiUsage_licenceId_day_key" ON "WindowsAiUsage"("licenceId", "day");

