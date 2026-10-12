-- CreateTable
CREATE TABLE "WindowsAiUsage" (
    "id" TEXT NOT NULL,
    "licenceId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "WindowsAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WindowsAiUsage_licenceId_day_key" ON "WindowsAiUsage"("licenceId", "day");


-- Like every table: closed to a database API such as Supabase's (src/lib/services/rls.db.test.ts).
ALTER TABLE "WindowsAiUsage" ENABLE ROW LEVEL SECURITY;
