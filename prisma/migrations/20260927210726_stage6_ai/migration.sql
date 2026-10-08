-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "riskReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "riskScore" INTEGER;

-- CreateTable
CREATE TABLE "AiProposal" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "memberIds" TEXT[],
    "body" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMPTZ,

    CONSTRAINT "AiProposal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiProposal_orgId_userId_createdAt_idx" ON "AiProposal"("orgId", "userId", "createdAt");
