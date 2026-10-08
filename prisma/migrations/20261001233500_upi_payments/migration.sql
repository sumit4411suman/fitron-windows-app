-- AlterTable
ALTER TABLE "BranchSubscription" ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMPTZ,
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMPTZ,
ADD COLUMN     "utr" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BranchSubscription_utr_key" ON "BranchSubscription"("utr");

-- CreateIndex
CREATE INDEX "BranchSubscription_status_idx" ON "BranchSubscription"("status");

